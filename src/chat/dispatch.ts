import type { MessageStructure } from "seyfert/lib/client/transformers";
import type { UsingClient } from "seyfert/lib/commands";
import { defaultRateLimiter, SlidingWindowRateLimiter } from "./rateLimiter";
import { playerRepo, PlayerRepository } from "../memory/playerRepo";
import {
  formatBufferForPrompt,
  addMessageToBuffer,
  getConversationHistory,
  ChannelMessageBuffer,
} from "../memory/buffer";
import { composeSystemPrompt } from "../ai/prompt";
import { generateChatReply, type AiProviderName } from "../ai/provider";
import { extractMemories, type ExtractMemoriesResult } from "../ai/extractor";
import { sanitizeMentions } from "../utils/sanitizer";
import { splitMessage } from "../utils/splitter";

export interface HandleChatMessageOptions {
  rateLimiter?: SlidingWindowRateLimiter;
  playerRepository?: PlayerRepository;
  aiProvider?: AiProviderName;
  model?: string;
  extractMemoriesFn?: typeof extractMemories;
  generateChatReplyFn?: typeof generateChatReply;
}

export interface HandleChatMessageResult {
  handled: boolean;
  rateLimited?: boolean;
  replies?: any[];
  replyText?: string;
  error?: unknown;
}

/**
 * Sends a single reply chunk via Seyfert Message or Client REST API.
 */
async function dispatchChunk(
  message: any,
  client: any,
  content: string,
  isFirst: boolean,
): Promise<any> {
  const payload = { content };

  // First chunk prefers in-thread / referenced message reply if available
  if (isFirst && typeof message.reply === "function") {
    try {
      return await message.reply(payload);
    } catch {
      // Fall through to write if referenced message was deleted or reply failed
    }
  }

  // Use channel write
  if (typeof message.write === "function") {
    return await message.write(payload);
  }

  if (client?.messages && typeof client.messages.write === "function") {
    return await client.messages.write(message.channelId, payload);
  }

  if (typeof message.reply === "function") {
    return await message.reply(payload);
  }

  throw new Error("No valid message dispatch method found on message or client.");
}

/**
 * Handles an incoming message that has triggered the bot:
 * 1. Enforces per-user sliding window rate limiting.
 * 2. Triggers channel typing indicator.
 * 3. Loads player dossier, server mood, and recent channel conversation history.
 * 4. Synthesizes system prompt and generates in-character response via LLM.
 * 5. Sanitizes mentions and chunks long replies (<= 2,000 chars) preserving code blocks.
 * 6. Dispatches chunks sequentially to Discord.
 * 7. Buffers bot replies into short-term channel memory.
 * 8. Asynchronously enqueues non-blocking memory/affinity extraction via queueMicrotask.
 */
export async function handleChatMessage(
  message: MessageStructure | any,
  client: UsingClient | any,
  options: HandleChatMessageOptions = {},
): Promise<HandleChatMessageResult> {
  if (!message || !message.author) {
    return { handled: false };
  }

  const userId = message.author.id;
  const authorName =
    message.member?.nick ||
    message.author.globalName ||
    message.author.username ||
    userId;

  // 1. Rate Limit Check
  const limiter = options.rateLimiter ?? defaultRateLimiter;
  if (!limiter.consume(userId)) {
    if (client.logger?.warn) {
      client.logger.warn(`[Chat Dispatch] Rate limit exceeded for user ${userId} (${authorName})`);
    }
    return { handled: false, rateLimited: true };
  }

  // 2. Trigger Typing Indicator (non-blocking failure)
  try {
    if (client.channels && typeof client.channels.typing === "function") {
      await client.channels.typing(message.channelId);
    }
  } catch (err) {
    if (client.logger?.warn) {
      client.logger.warn(`[Chat Dispatch] Failed to trigger typing in channel ${message.channelId}:`, err);
    }
  }

  const repo = options.playerRepository ?? playerRepo;

  // 3. Load Context: Dossier + Mood + Formatted Buffer + Structured Multi-Turn Turns
  const dossier = repo.getPlayerDossier(userId);
  const guildMood = message.guildId ? repo.getBotMood(message.guildId) : null;
  const formattedBuffer = formatBufferForPrompt(message.channelId);

  // Retrieve prior turns excluding the message just buffered, so history is not duplicated
  const conversationHistory = getConversationHistory(message.channelId, {
    excludeLast: true,
    limit: 12,
  });

  // Clean mention tokens (<@botId>, <@!botId>) from the user's prompt text
  let userMessage = message.content ?? "";
  const botId = client.botId ?? client.me?.id;
  if (botId) {
    userMessage = userMessage.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
  }
  if (!userMessage) {
    userMessage = message.content ?? "";
  }

  // 4. Synthesize System Prompt & Invoke LLM
  const botName = client.me?.username ?? "Gridgeist";
  const systemPrompt = composeSystemPrompt({
    botName,
    dossier,
    guildMood,
    channelHistoryFormatted: formattedBuffer,
  });

  const generateReply = options.generateChatReplyFn ?? generateChatReply;
  let replyText = "";

  try {
    replyText = await generateReply({
      systemPrompt,
      conversationHistory,
      userMessage,
      provider: options.aiProvider,
      model: options.model,
    });
  } catch (err) {
    if (client.logger?.error) {
      client.logger.error("[Chat Dispatch] LLM generation failed:", err);
    }
    replyText = "*A brief power surge echoes through the circuitry. My connection to the datastream glitched—let's try that again.*";
  }

  // 5. Sanitize Mentions & Chunk Output
  const sanitized = sanitizeMentions(replyText);
  const chunks = splitMessage(sanitized);

  // 6. Send Sequential Replies
  const sentReplies: any[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const sent = await dispatchChunk(message, client, chunk, i === 0);
      sentReplies.push(sent);

      // Record bot reply in channel buffer
      addMessageToBuffer(message.channelId, {
        authorId: botId || "gridgeist-bot",
        authorName: botName,
        isBot: true,
        content: chunk,
        timestamp: Date.now(),
        replyToAuthorName: i === 0 ? authorName : null,
      });
    }
  } catch (err) {
    if (client.logger?.error) {
      client.logger.error("[Chat Dispatch] Failed to send chat reply:", err);
    }
    return { handled: false, error: err };
  }

  // 7. Enqueue Non-Blocking Background Memory Extraction
  const extractor = options.extractMemoriesFn ?? extractMemories;
  queueMicrotask(() => {
    try {
      extractor({
        userId,
        userName: authorName,
        userMessage: message.content ?? "",
        botReply: replyText,
        channelHistory: formattedBuffer,
        dossier,
        playerRepository: repo,
        provider: options.aiProvider,
        model: options.model,
      }).catch((extractErr) => {
        if (client.logger?.error) {
          client.logger.error(`[Chat Dispatch] Background memory extraction failed for ${userId}:`, extractErr);
        }
      });
    } catch (microtaskErr) {
      if (client.logger?.error) {
        client.logger.error(`[Chat Dispatch] Failed to enqueue memory extraction for ${userId}:`, microtaskErr);
      }
    }
  });

  return {
    handled: true,
    replies: sentReplies,
    replyText,
  };
}
