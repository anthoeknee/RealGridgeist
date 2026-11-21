import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { shouldRespondToMessage } from "../src/chat/trigger";
import { handleChatMessage } from "../src/chat/dispatch";
import { SlidingWindowRateLimiter } from "../src/chat/rateLimiter";
import { initDatabase } from "../src/memory/db";
import { playerRepo } from "../src/memory/playerRepo";
import { clearAllBuffers, getBuffer } from "../src/memory/buffer";

describe("Chat Trigger Evaluation (src/chat/trigger.ts)", () => {
  const BOT_ID = "bot-gridgeist-12345";
  const CLIENT_MOCK = {
    botId: BOT_ID,
    me: { id: BOT_ID },
  };

  describe("Direct Messages (DMs)", () => {
    it("returns true for DMs when guildId is undefined", () => {
      const msg = {
        author: { id: "user-1", username: "Alice", bot: false },
        content: "Hey there!",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
      expect(shouldRespondToMessage(msg, CLIENT_MOCK)).toBe(true);
    });

    it("returns true for DMs when guildId is null", () => {
      const msg = {
        author: { id: "user-1", username: "Alice", bot: false },
        guildId: null,
        content: "Are you awake?",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns true for DMs when guildId is empty string", () => {
      const msg = {
        author: { id: "user-1", username: "Alice", bot: false },
        guildId: "   ",
        content: "Echo test",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns false for DMs if the author is a bot", () => {
      const msg = {
        author: { id: "other-bot", username: "SpamBot", bot: true },
        guildId: undefined,
        content: "Beep boop",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });
  });

  describe("Direct Bot Mentions in Guilds", () => {
    it("returns true when message contains standard mention <@botId>", () => {
      const msg = {
        author: { id: "user-2", username: "Bob", bot: false },
        guildId: "guild-999",
        content: `Hello <@${BOT_ID}>, how are you?`,
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns true when message contains nickname mention <@!botId>", () => {
      const msg = {
        author: { id: "user-2", username: "Bob", bot: false },
        guildId: "guild-999",
        content: `<@!${BOT_ID}> what is your current mood?`,
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns true when mention is at the very end of message", () => {
      const msg = {
        author: { id: "user-2", username: "Bob", bot: false },
        guildId: "guild-999",
        content: `Wake up <@${BOT_ID}>`,
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns false when message mentions another user", () => {
      const msg = {
        author: { id: "user-2", username: "Bob", bot: false },
        guildId: "guild-999",
        content: "Hey <@other-user-888> look at this!",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });

    it("returns false for partial mention syntax without closing bracket", () => {
      const msg = {
        author: { id: "user-2", username: "Bob", bot: false },
        guildId: "guild-999",
        content: `<@${BOT_ID} unfinished mention`,
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });

    it("returns false when bot mentions itself or another bot mentions it", () => {
      const msg = {
        author: { id: "bot-helper", username: "HelperBot", bot: true },
        guildId: "guild-999",
        content: `<@${BOT_ID}> ping`,
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });
  });

  describe("Replies to Bot Messages", () => {
    it("returns true when referencedAuthorId matches botId", () => {
      const msg = {
        author: { id: "user-3", username: "Charlie", bot: false },
        guildId: "guild-999",
        content: "That was hilarious!",
        referencedAuthorId: BOT_ID,
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns true when referencedMessage.author.id matches botId", () => {
      const msg = {
        author: { id: "user-3", username: "Charlie", bot: false },
        guildId: "guild-999",
        content: "Tell me more.",
        referencedMessage: {
          author: { id: BOT_ID, username: "Gridgeist", bot: true },
        },
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(true);
    });

    it("returns false when replying to another human user", () => {
      const msg = {
        author: { id: "user-3", username: "Charlie", bot: false },
        guildId: "guild-999",
        content: "Good point, Alice.",
        referencedAuthorId: "user-1",
        referencedMessage: {
          author: { id: "user-1", username: "Alice", bot: false },
        },
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });

    it("returns false when replying to another bot (not Gridgeist)", () => {
      const msg = {
        author: { id: "user-3", username: "Charlie", bot: false },
        guildId: "guild-999",
        content: "Nice music bot.",
        referencedAuthorId: "music-bot-777",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });
  });

  describe("Background Chatter & Invalid Messages", () => {
    it("returns false for regular background conversation in guild", () => {
      const msg = {
        author: { id: "user-4", username: "Dave", bot: false },
        guildId: "guild-999",
        content: "Anyone up for a raid tonight?",
      };
      expect(shouldRespondToMessage(msg, BOT_ID)).toBe(false);
    });

    it("returns false when message is null or undefined", () => {
      expect(shouldRespondToMessage(null, BOT_ID)).toBe(false);
      expect(shouldRespondToMessage(undefined, BOT_ID)).toBe(false);
    });

    it("returns false when author is missing", () => {
      const msg = {
        guildId: "guild-999",
        content: "System message",
      };
      expect(shouldRespondToMessage(msg as any, BOT_ID)).toBe(false);
    });

    it("returns false in guild when botId cannot be determined", () => {
      const msg = {
        author: { id: "user-4", username: "Dave", bot: false },
        guildId: "guild-999",
        content: "<@bot-gridgeist-12345> hello",
      };
      expect(shouldRespondToMessage(msg, null)).toBe(false);
      expect(shouldRespondToMessage(msg, undefined)).toBe(false);
    });
  });
});

describe("Chat Response Dispatch Pipeline (src/chat/dispatch.ts)", () => {
  let db: Database;
  const BOT_ID = "bot-gridgeist-12345";

  beforeEach(() => {
    db = initDatabase(":memory:");
    playerRepo.setDatabase(db);
    clearAllBuffers();
  });

  afterEach(() => {
    clearAllBuffers();
    db.close();
  });

  it("blocks message dispatch when rate limit is exceeded", async () => {
    const rateLimiter = new SlidingWindowRateLimiter({
      limit: 1,
      windowMs: 30_000,
      autoCleanup: false,
    });

    let typingTriggered = false;
    const client = {
      botId: BOT_ID,
      me: { id: BOT_ID, username: "Gridgeist" },
      logger: { warn: () => {}, error: () => {} },
      channels: {
        typing: async () => {
          typingTriggered = true;
        },
      },
    };

    const mockMessage = {
      channelId: "c-100",
      content: `<@${BOT_ID}> first message`,
      author: { id: "user-ratelimited", username: "Spammer", bot: false },
      reply: async () => ({ id: "m-1" }),
    };

    // First request succeeds
    const firstResult = await handleChatMessage(mockMessage, client, {
      rateLimiter,
      generateChatReplyFn: async () => "Hello!",
    });
    expect(firstResult.handled).toBe(true);
    expect(firstResult.rateLimited).toBeUndefined();
    expect(typingTriggered).toBe(true);

    // Second request is blocked by rate limiter
    typingTriggered = false;
    const secondResult = await handleChatMessage(mockMessage, client, {
      rateLimiter,
      generateChatReplyFn: async () => "Hello again!",
    });
    expect(secondResult.handled).toBe(false);
    expect(secondResult.rateLimited).toBe(true);
    expect(typingTriggered).toBe(false);
  });

  it("triggers typing, loads dossier context, sanitizes mentions, and enqueues extraction", async () => {
    // Populate existing dossier and bot mood
    playerRepo.upsertPlayer({
      user_id: "user-alice",
      username: "Alice",
      preferred_name: "Ally",
      affinity: 50,
      summary: "A passionate puzzle solver",
    });
    playerRepo.addFact("user-alice", "Loves retro synthwave", "preference");
    playerRepo.upsertBotMood({
      guild_id: "guild-1",
      energy: 85,
      warmth: 70,
      sarcasm: 40,
      current_vibe: "energetic",
    });

    let typingChannel: string | null = null;
    const dispatchedMessages: string[] = [];
    let passedSystemPrompt = "";

    const client = {
      botId: BOT_ID,
      me: { id: BOT_ID, username: "Gridgeist" },
      logger: { warn: () => {}, error: () => {} },
      channels: {
        typing: async (ch: string) => {
          typingChannel = ch;
        },
      },
    };

    const mockMessage = {
      channelId: "channel-42",
      guildId: "guild-1",
      content: `<@${BOT_ID}> Can you ping @everyone and <@&99999>?`,
      author: { id: "user-alice", username: "Alice", bot: false },
      reply: async (body: { content: string }) => {
        dispatchedMessages.push(body.content);
        return { id: "reply-1", content: body.content };
      },
      write: async (body: { content: string }) => {
        dispatchedMessages.push(body.content);
        return { id: "reply-2", content: body.content };
      },
    };

    let extractionOptionsPassed: any = null;
    const mockExtractMemories = async (opts: any) => {
      extractionOptionsPassed = opts;
      return null;
    };

    const mockGenerateReply = async (opts: any) => {
      passedSystemPrompt = opts.systemPrompt;
      // Reply includes dangerous mentions that must be sanitized
      return "Sure thing! Pinging @everyone, @here, and <@&99999> right now!";
    };

    const result = await handleChatMessage(mockMessage, client, {
      generateChatReplyFn: mockGenerateReply,
      extractMemoriesFn: mockExtractMemories as any,
    });

    expect(result.handled).toBe(true);
    expect(typingChannel).toBe("channel-42");

    // Verify context was injected into system prompt
    expect(passedSystemPrompt).toContain("Ally");
    expect(passedSystemPrompt).toContain("Loves retro synthwave");
    expect(passedSystemPrompt).toContain("Current Vibe: energetic");

    // Verify mentions were sanitized with zero-width spaces (\u200B)
    expect(dispatchedMessages).toHaveLength(1);
    expect(dispatchedMessages[0]).not.toContain("@everyone");
    expect(dispatchedMessages[0]).toContain("@\u200Beveryone");
    expect(dispatchedMessages[0]).toContain("@\u200Bhere");
    expect(dispatchedMessages[0]).toContain("<@&\u200B99999>");

    // Verify bot response was buffered into channel memory
    const buffer = getBuffer("channel-42");
    expect(buffer.length).toBeGreaterThan(0);
    const lastBuffered = buffer[buffer.length - 1];
    expect(lastBuffered.isBot).toBe(true);
    expect(lastBuffered.authorName).toBe("Gridgeist");

    // Wait for queueMicrotask to execute background memory extraction
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(extractionOptionsPassed).not.toBeNull();
    expect(extractionOptionsPassed.userId).toBe("user-alice");
    expect(extractionOptionsPassed.userName).toBe("Alice");
    expect(extractionOptionsPassed.userMessage).toContain(`<@${BOT_ID}>`);
  });

  it("splits long responses (>2000 chars) into sequential message chunks", async () => {
    const client = {
      botId: BOT_ID,
      me: { id: BOT_ID, username: "Gridgeist" },
      logger: { warn: () => {}, error: () => {} },
      channels: { typing: async () => {} },
    };

    const dispatchedReplies: string[] = [];
    const mockMessage = {
      channelId: "channel-long",
      content: "Explain quantum computing in detail",
      author: { id: "user-curious", username: "CuriousCat", bot: false },
      reply: async (body: { content: string }) => {
        dispatchedReplies.push(body.content);
        return { id: "chunk-1" };
      },
      write: async (body: { content: string }) => {
        dispatchedReplies.push(body.content);
        return { id: `chunk-${dispatchedReplies.length + 1}` };
      },
    };

    // Construct a long text with 2 distinct paragraphs totaling 3,000 characters
    const p1 = "A".repeat(1600);
    const p2 = "B".repeat(1400);
    const longReply = `${p1}\n\n${p2}`;

    const result = await handleChatMessage(mockMessage, client, {
      generateChatReplyFn: async () => longReply,
      extractMemoriesFn: async () => null,
    });

    expect(result.handled).toBe(true);
    // Should have split into 2 chunks along the paragraph boundary
    expect(dispatchedReplies.length).toBe(2);
    expect(dispatchedReplies[0].length).toBeLessThanOrEqual(2000);
    expect(dispatchedReplies[1].length).toBeLessThanOrEqual(2000);
    expect(dispatchedReplies[0]).toBe(p1);
    expect(dispatchedReplies[1]).toBe(p2);
  });
});
