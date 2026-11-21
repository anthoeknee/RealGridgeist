import type { MessageStructure } from "seyfert/lib/client/transformers";

/**
 * Flexible interface representing message properties required to evaluate trigger criteria.
 * Compatible with Seyfert Message / MessageStructure as well as plain mock objects.
 */
export interface TriggerMessage {
  author?: {
    id: string;
    bot?: boolean;
    username?: string;
    globalName?: string | null;
  } | null;
  guildId?: string | null;
  content?: string | null;
  referencedMessage?: {
    author?: {
      id: string;
      bot?: boolean;
      username?: string;
      globalName?: string | null;
    } | null;
  } | null;
  referencedAuthorId?: string | null;
}

export interface ClientLike {
  botId?: string;
  me?: {
    id?: string;
  };
}

/**
 * Escapes regex special characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Evaluates whether Gridgeist should respond to an incoming message.
 *
 * Rules:
 * - Returns FALSE for messages from bots (including self or other bots) or messages lacking an author.
 * - Returns TRUE for Direct Messages (DMs, where guildId is absent, null, or empty).
 * - Returns TRUE for direct bot mentions (<@botId> or <@!botId>).
 * - Returns TRUE for replies to the bot's prior messages (referencedAuthorId === botId).
 * - Returns FALSE for background chatter in guilds (unmentioned, non-reply, non-DM).
 *
 * @param message The incoming Discord message or message-like structure.
 * @param botIdOrClient The bot user ID or Seyfert client instance.
 * @returns boolean indicating whether the bot should respond.
 */
export function shouldRespondToMessage(
  message: TriggerMessage | MessageStructure | null | undefined,
  botIdOrClient?: string | ClientLike | null,
): boolean {
  if (!message || !message.author) {
    return false;
  }

  // Never respond to bot messages (prevents infinite loops or responding to self/other bots)
  if (Boolean(message.author.bot)) {
    return false;
  }

  // 1. Direct Messages (DM channels have no guildId)
  if (!message.guildId || message.guildId.trim().length === 0) {
    return true;
  }

  // Resolve bot ID
  const resolvedBotId =
    typeof botIdOrClient === "string"
      ? botIdOrClient.trim()
      : botIdOrClient?.botId ?? botIdOrClient?.me?.id ?? "";

  if (!resolvedBotId) {
    // If botId cannot be determined and this is a guild channel, cannot verify mention or reply
    return false;
  }

  // 2. Direct Bot Mentions (<@botId> or <@!botId>)
  const content = message.content ?? "";
  if (content.length > 0) {
    const mentionRegex = new RegExp(`<@!?${escapeRegExp(resolvedBotId)}>`);
    if (mentionRegex.test(content)) {
      return true;
    }
  }

  // 3. Replies to the bot's messages (referencedAuthorId === botId)
  const referencedAuthorId =
    ("referencedAuthorId" in message ? (message as any).referencedAuthorId : null) ??
    message.referencedMessage?.author?.id ??
    null;

  if (referencedAuthorId && referencedAuthorId === resolvedBotId) {
    return true;
  }

  // 4. Background chatter in guild channels
  return false;
}
