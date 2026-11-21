import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  ChannelMessageBuffer,
  defaultMessageBuffer,
  channelBuffers,
  addMessageToBuffer,
  getBuffer,
  formatBufferForPrompt,
  getConversationHistory,
  clearBuffer,
  clearAllBuffers,
  pruneExpiredBuffers,
  isChannelExpired,
  DEFAULT_MAX_MESSAGES_PER_CHANNEL,
  DEFAULT_BUFFER_TTL_MS,
} from "../src/memory/buffer";
import type { BufferedMessage } from "../src/memory/types";

describe("Short-Term Channel Message Buffer", () => {
  beforeEach(() => {
    clearAllBuffers();
  });

  afterEach(() => {
    clearAllBuffers();
  });

  describe("Requirement 1: In-Memory Map keyed by channelId", () => {
    it("exposes channelBuffers as an in-memory Map<string, BufferedMessage[]>", () => {
      expect(channelBuffers).toBeInstanceOf(Map);
      expect(channelBuffers.size).toBe(0);

      addMessageToBuffer("ch-1", {
        authorId: "user-1",
        authorName: "Alice",
        content: "Hello world!",
      });

      expect(channelBuffers.has("ch-1")).toBe(true);
      const messages = channelBuffers.get("ch-1");
      expect(Array.isArray(messages)).toBe(true);
      expect(messages?.length).toBe(1);
    });

    it("isolates message buffers across multiple channels", () => {
      addMessageToBuffer("channel-a", {
        authorId: "u1",
        authorName: "Alice",
        content: "Message in A",
      });

      addMessageToBuffer("channel-b", {
        authorId: "u2",
        authorName: "Bob",
        content: "Message in B",
      });

      const bufferA = getBuffer("channel-a");
      const bufferB = getBuffer("channel-b");

      expect(bufferA).toHaveLength(1);
      expect(bufferA[0].content).toBe("Message in A");

      expect(bufferB).toHaveLength(1);
      expect(bufferB[0].content).toBe("Message in B");
    });
  });

  describe("Requirement 2: Storing up to 20 messages with all metadata", () => {
    it("stores all required fields: authorId, authorName, isBot, content, timestamp, replyToAuthorName", () => {
      const fixedTime = 1700000000000;
      addMessageToBuffer("ch-meta", {
        authorId: "12345",
        authorName: "Alice",
        isBot: false,
        content: "Hey, can anyone help?",
        timestamp: fixedTime,
        replyToAuthorName: "Bob",
      });

      const messages = getBuffer("ch-meta");
      expect(messages).toHaveLength(1);

      const msg = messages[0];
      expect(msg.authorId).toBe("12345");
      expect(msg.authorName).toBe("Alice");
      expect(msg.isBot).toBe(false);
      expect(msg.content).toBe("Hey, can anyone help?");
      expect(msg.timestamp).toBe(fixedTime);
      expect(msg.replyToAuthorName).toBe("Bob");
    });

    it("defaults isBot to false and timestamp to now if omitted", () => {
      const before = Date.now();
      addMessageToBuffer("ch-defaults", {
        authorId: "u1",
        authorName: "Charlie",
        content: "No bot, no timestamp provided",
      });
      const after = Date.now();

      const [msg] = getBuffer("ch-defaults");
      expect(msg.isBot).toBe(false);
      expect(msg.replyToAuthorName).toBeNull();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it("converts Date objects to numeric timestamps", () => {
      const date = new Date("2026-05-15T12:00:00Z");
      addMessageToBuffer("ch-date", {
        authorId: "u1",
        authorName: "Dave",
        content: "Dated message",
        timestamp: date,
      });

      const [msg] = getBuffer("ch-date");
      expect(msg.timestamp).toBe(date.getTime());
    });

    it("retains all messages when up to 20 are added in chronological order", () => {
      for (let i = 1; i <= 20; i++) {
        addMessageToBuffer("ch-20", {
          authorId: `user-${i}`,
          authorName: `User ${i}`,
          content: `Message ${i}`,
          timestamp: 1000 + i,
        });
      }

      const buffer = getBuffer("ch-20");
      expect(buffer).toHaveLength(20);
      expect(buffer[0].content).toBe("Message 1");
      expect(buffer[19].content).toBe("Message 20");
    });

    it("strictly caps buffer at 20 messages, evicting the oldest messages", () => {
      // Add 25 messages
      for (let i = 1; i <= 25; i++) {
        addMessageToBuffer("ch-cap", {
          authorId: `user-${i}`,
          authorName: `User ${i}`,
          content: `Message ${i}`,
          timestamp: 1000 + i,
        });
      }

      const buffer = getBuffer("ch-cap");
      expect(buffer).toHaveLength(DEFAULT_MAX_MESSAGES_PER_CHANNEL);
      // Messages 1 through 5 must have been evicted
      expect(buffer[0].content).toBe("Message 6");
      expect(buffer[19].content).toBe("Message 25");
    });

    it("returns a defensive copy from getBuffer to protect internal state", () => {
      addMessageToBuffer("ch-copy", {
        authorId: "u1",
        authorName: "Alice",
        content: "Original",
      });

      const copy = getBuffer("ch-copy");
      copy.pop(); // Mutate the returned array

      const fresh = getBuffer("ch-copy");
      expect(fresh).toHaveLength(1);
      expect(fresh[0].content).toBe("Original");
    });
  });

  describe("Requirement 3: Automatic expiration of inactive channels older than 2 hours", () => {
    it("does not expire channels active within the 2-hour window", () => {
      const now = 10_000_000;
      const recentTimestamp = now - (DEFAULT_BUFFER_TTL_MS - 60_000); // 1h 59m ago

      addMessageToBuffer(
        "ch-active",
        {
          authorId: "u1",
          authorName: "Alice",
          content: "Active message",
          timestamp: recentTimestamp,
        },
        recentTimestamp,
      );

      expect(isChannelExpired("ch-active", now)).toBe(false);
      const messages = getBuffer("ch-active", now);
      expect(messages).toHaveLength(1);
    });

    it("detects expired channels when last activity is older than 2 hours", () => {
      const now = 10_000_000;
      const oldTimestamp = now - (DEFAULT_BUFFER_TTL_MS + 1000); // 2h and 1s ago

      addMessageToBuffer(
        "ch-expired",
        {
          authorId: "u1",
          authorName: "Alice",
          content: "Old message",
          timestamp: oldTimestamp,
        },
        oldTimestamp,
      );

      expect(isChannelExpired("ch-expired", now)).toBe(true);
    });

    it("prunes expired channels with pruneExpiredBuffers() and flattens memory", () => {
      const now = 20_000_000;
      const oldTime = now - (DEFAULT_BUFFER_TTL_MS + 5000);
      const recentTime = now - 60_000;

      // Channel 1: Expired
      addMessageToBuffer(
        "ch-old-1",
        {
          authorId: "u1",
          authorName: "OldUser",
          content: "Expired 1",
          timestamp: oldTime,
        },
        oldTime,
      );

      // Channel 2: Expired
      addMessageToBuffer(
        "ch-old-2",
        {
          authorId: "u2",
          authorName: "OldUser",
          content: "Expired 2",
          timestamp: oldTime,
        },
        oldTime,
      );

      // Channel 3: Fresh
      addMessageToBuffer(
        "ch-fresh",
        {
          authorId: "u3",
          authorName: "FreshUser",
          content: "Fresh",
          timestamp: recentTime,
        },
        recentTime,
      );

      expect(channelBuffers.size).toBe(3);

      const pruned = pruneExpiredBuffers(now);
      expect(pruned).toBe(2);

      expect(channelBuffers.size).toBe(1);
      expect(channelBuffers.has("ch-old-1")).toBe(false);
      expect(channelBuffers.has("ch-old-2")).toBe(false);
      expect(channelBuffers.has("ch-fresh")).toBe(true);
    });

    it("lazily evicts expired buffer on getBuffer() access", () => {
      const now = 30_000_000;
      const oldTime = now - (DEFAULT_BUFFER_TTL_MS + 10_000);

      addMessageToBuffer(
        "ch-lazy",
        {
          authorId: "u1",
          authorName: "Alice",
          content: "Stale message",
          timestamp: oldTime,
        },
        oldTime,
      );

      expect(channelBuffers.has("ch-lazy")).toBe(true);

      // Accessing with now > 2h later should return empty and prune from map
      const messages = getBuffer("ch-lazy", now);
      expect(messages).toEqual([]);
      expect(channelBuffers.has("ch-lazy")).toBe(false);
    });

    it("resets buffer when a new message arrives in an expired channel", () => {
      const startTime = 10_000_000;
      const oldTime = startTime;
      const laterTime = startTime + DEFAULT_BUFFER_TTL_MS + 60_000; // 2h 1m later

      // Initial message
      addMessageToBuffer(
        "ch-reset",
        {
          authorId: "u1",
          authorName: "Alice",
          content: "Original conversation 2 hours ago",
          timestamp: oldTime,
        },
        oldTime,
      );

      // Channel inactive for > 2 hours; new message arrives
      addMessageToBuffer(
        "ch-reset",
        {
          authorId: "u2",
          authorName: "Bob",
          content: "New conversation starting now",
          timestamp: laterTime,
        },
        laterTime,
      );

      const buffer = getBuffer("ch-reset", laterTime);
      expect(buffer).toHaveLength(1);
      expect(buffer[0].authorName).toBe("Bob");
      expect(buffer[0].content).toBe("New conversation starting now");
    });

    it("supports isolated ChannelMessageBuffer instances with custom TTL and intervals", async () => {
      const customBuffer = new ChannelMessageBuffer({
        maxMessages: 5,
        ttlMs: 50, // 50ms TTL
        cleanupIntervalMs: 25, // 25ms cleanup ticks
        autoStartCleanup: true,
      });

      customBuffer.addMessage("temp-ch", {
        authorId: "u1",
        authorName: "Fast",
        content: "Will vanish soon",
      });

      expect(customBuffer.getChannelCount()).toBe(1);

      // Wait for TTL and background cleanup to fire
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(customBuffer.getChannelCount()).toBe(0);
      expect(customBuffer.getMessages("temp-ch")).toEqual([]);

      customBuffer.stopCleanupTimer();
    });
  });

  describe("Requirement 4: formatBufferForPrompt(channelId)", () => {
    it("returns an empty string when the channel does not exist or has expired", () => {
      expect(formatBufferForPrompt("nonexistent")).toBe("");

      const now = 50_000_000;
      const oldTime = now - (DEFAULT_BUFFER_TTL_MS + 1000);
      addMessageToBuffer(
        "expired-format",
        {
          authorId: "u1",
          authorName: "Alice",
          content: "Hello",
          timestamp: oldTime,
        },
        oldTime,
      );

      expect(formatBufferForPrompt("expired-format", undefined, now)).toBe("");
    });

    it("formats a clean dialogue script for human messages", () => {
      addMessageToBuffer("ch-chat", {
        authorId: "u1",
        authorName: "Alice",
        content: "Has anyone found the secret dungeon entrance?",
      });

      addMessageToBuffer("ch-chat", {
        authorId: "u2",
        authorName: "Bob",
        content: "Check behind the waterfall in Sector 4.",
      });

      const formatted = formatBufferForPrompt("ch-chat");
      const lines = formatted.split("\n");

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("Alice: Has anyone found the secret dungeon entrance?");
      expect(lines[1]).toBe("Bob: Check behind the waterfall in Sector 4.");
    });

    it("clearly marks message replies (replying to <author>)", () => {
      addMessageToBuffer("ch-reply", {
        authorId: "u1",
        authorName: "Alice",
        content: "I have 5 extra potions.",
      });

      addMessageToBuffer("ch-reply", {
        authorId: "u2",
        authorName: "Bob",
        content: "I'll trade you 10 arrows for 2 of them!",
        replyToAuthorName: "Alice",
      });

      const formatted = formatBufferForPrompt("ch-reply");
      expect(formatted).toBe(
        "Alice: I have 5 extra potions.\nBob (replying to Alice): I'll trade you 10 arrows for 2 of them!",
      );
    });

    it("clearly tags bot messages with [BOT]", () => {
      addMessageToBuffer("ch-bot", {
        authorId: "bot-id",
        authorName: "Gridgeist",
        isBot: true,
        content: "Server reset in 10 minutes. Please save your progress.",
      });

      const formatted = formatBufferForPrompt("ch-bot");
      expect(formatted).toBe(
        "Gridgeist [BOT]: Server reset in 10 minutes. Please save your progress.",
      );
    });

    it("handles bot replying to a human and human replying to a bot", () => {
      addMessageToBuffer("ch-interact", {
        authorId: "u1",
        authorName: "Alice",
        content: "Hey Gridgeist, what's my current affinity score?",
      });

      addMessageToBuffer("ch-interact", {
        authorId: "bot-id",
        authorName: "Gridgeist",
        isBot: true,
        content: "Your affinity is at 42. You're one of the favored few.",
        replyToAuthorName: "Alice",
      });

      addMessageToBuffer("ch-interact", {
        authorId: "u2",
        authorName: "Bob",
        content: "Don't flatter her too much, ghost.",
        replyToAuthorName: "Gridgeist",
      });

      const formatted = formatBufferForPrompt("ch-interact");
      const expected = [
        "Alice: Hey Gridgeist, what's my current affinity score?",
        "Gridgeist [BOT] (replying to Alice): Your affinity is at 42. You're one of the favored few.",
        "Bob (replying to Gridgeist): Don't flatter her too much, ghost.",
      ].join("\n");

      expect(formatted).toBe(expected);
    });

    it("prevents AI confusion across busy multi-human conversations with overlapping speakers", () => {
      const scriptMessages = [
        { authorId: "1", authorName: "Alice", content: "Is the raid team ready?" },
        { authorId: "2", authorName: "Bob", content: "I'm in." },
        { authorId: "3", authorName: "Charlie", content: "Give me 5 mins." },
        { authorId: "2", authorName: "Bob", replyToAuthorName: "Charlie", content: "Hurry up man." },
        { authorId: "1", authorName: "Alice", replyToAuthorName: "Bob", content: "Be patient Bob." },
        {
          authorId: "bot",
          authorName: "Gridgeist",
          isBot: true,
          content: "Raid lobby lock engaged. Timer started.",
        },
      ];

      for (const msg of scriptMessages) {
        addMessageToBuffer("ch-busy", msg);
      }

      const formatted = formatBufferForPrompt("ch-busy");
      const lines = formatted.split("\n");

      expect(lines).toHaveLength(6);
      expect(lines[0]).toBe("Alice: Is the raid team ready?");
      expect(lines[1]).toBe("Bob: I'm in.");
      expect(lines[2]).toBe("Charlie: Give me 5 mins.");
      expect(lines[3]).toBe("Bob (replying to Charlie): Hurry up man.");
      expect(lines[4]).toBe("Alice (replying to Bob): Be patient Bob.");
      expect(lines[5]).toBe("Gridgeist [BOT]: Raid lobby lock engaged. Timer started.");
    });

    it("respects formatting options like limit and tag toggles", () => {
      for (let i = 1; i <= 5; i++) {
        addMessageToBuffer("ch-opts", {
          authorId: `u${i}`,
          authorName: `User${i}`,
          isBot: i % 2 === 0,
          content: `Line ${i}`,
          replyToAuthorName: i > 1 ? `User${i - 1}` : null,
        });
      }

      // Test limit
      const limited = formatBufferForPrompt("ch-opts", { limit: 2 });
      const limitedLines = limited.split("\n");
      expect(limitedLines).toHaveLength(2);
      expect(limitedLines[0]).toBe("User4 [BOT] (replying to User3): Line 4");
      expect(limitedLines[1]).toBe("User5 (replying to User4): Line 5");

      // Test disabling bot tag and reply tag
      const plain = formatBufferForPrompt("ch-opts", {
        limit: 2,
        includeBotTag: false,
        includeReplies: false,
      });
      expect(plain).toBe("User4: Line 4\nUser5: Line 5");
    });

    it("handles whitespace trimming and empty messages gracefully", () => {
      addMessageToBuffer("ch-clean", {
        authorId: "u1",
        authorName: "  Alice  ",
        content: "   Message with extra spaces   ",
        replyToAuthorName: "  Bob  ",
      });

      addMessageToBuffer("ch-clean", {
        authorId: "u2",
        authorName: "Bob",
        content: "   ",
      });

      const formatted = formatBufferForPrompt("ch-clean");
      const lines = formatted.split("\n");

      expect(lines[0]).toBe("Alice (replying to Bob): Message with extra spaces");
      expect(lines[1]).toBe("Bob: [empty message]");
    });
  });

  describe("Multi-Turn Conversation Turns (getConversationHistory)", () => {
    it("returns empty array for empty or uninitialized channels", () => {
      const history = defaultMessageBuffer.getConversationHistory("non-existent-ch");
      expect(history).toEqual([]);
    });

    it("formats user and bot turns with appropriate roles and speaker labels", () => {
      addMessageToBuffer("ch-conv", {
        authorId: "user-1",
        authorName: "Alice",
        content: "What is the square root of 64?",
      });
      addMessageToBuffer("ch-conv", {
        authorId: "bot-1",
        authorName: "Gridgeist",
        isBot: true,
        content: "The square root of 64 is 8.",
      });
      addMessageToBuffer("ch-conv", {
        authorId: "user-2",
        authorName: "Bob",
        content: "Thanks!",
        replyToAuthorName: "Gridgeist",
      });

      const turns = defaultMessageBuffer.getConversationHistory("ch-conv");
      expect(turns).toHaveLength(3);
      expect(turns[0]).toEqual({
        role: "user",
        content: "[Alice]: What is the square root of 64?",
        authorName: "Alice",
        isBot: false,
      });
      expect(turns[1]).toEqual({
        role: "model",
        content: "The square root of 64 is 8.",
        authorName: "Gridgeist",
        isBot: true,
      });
      expect(turns[2]).toEqual({
        role: "user",
        content: "[Bob (replying to Gridgeist)]: Thanks!",
        authorName: "Bob",
        isBot: false,
      });
    });

    it("supports excludeLast: true to exclude the current active prompt message", () => {
      addMessageToBuffer("ch-turns", { authorId: "u1", authorName: "Alice", content: "Turn 1" });
      addMessageToBuffer("ch-turns", { authorId: "b1", authorName: "Gridgeist", isBot: true, content: "Turn 2" });
      addMessageToBuffer("ch-turns", { authorId: "u1", authorName: "Alice", content: "Turn 3 (current prompt)" });

      const priorTurns = defaultMessageBuffer.getConversationHistory("ch-turns", { excludeLast: true });
      expect(priorTurns).toHaveLength(2);
      expect(priorTurns[0].content).toContain("Turn 1");
      expect(priorTurns[1].content).toBe("Turn 2");
    });

    it("limits turns cleanly with options.limit", () => {
      for (let i = 1; i <= 5; i++) {
        addMessageToBuffer("ch-limit", { authorId: "u1", authorName: "Alice", content: `Msg ${i}` });
      }

      const turns = defaultMessageBuffer.getConversationHistory("ch-limit", { limit: 2 });
      expect(turns).toHaveLength(2);
      expect(turns[0].content).toContain("Msg 4");
      expect(turns[1].content).toContain("Msg 5");
    });
  });

  describe("Buffer Management & Utilities", () => {
    it("clears a single channel with clearBuffer()", () => {
      addMessageToBuffer("ch-1", {
        authorId: "u1",
        authorName: "Alice",
        content: "In 1",
      });
      addMessageToBuffer("ch-2", {
        authorId: "u2",
        authorName: "Bob",
        content: "In 2",
      });

      expect(clearBuffer("ch-1")).toBe(true);
      expect(clearBuffer("ch-1")).toBe(false);

      expect(getBuffer("ch-1")).toEqual([]);
      expect(getBuffer("ch-2")).toHaveLength(1);
    });

    it("clears all channels with clearAllBuffers()", () => {
      addMessageToBuffer("ch-1", { authorId: "u1", authorName: "Alice", content: "A" });
      addMessageToBuffer("ch-2", { authorId: "u2", authorName: "Bob", content: "B" });

      expect(channelBuffers.size).toBe(2);
      clearAllBuffers();
      expect(channelBuffers.size).toBe(0);
    });
  });
});
