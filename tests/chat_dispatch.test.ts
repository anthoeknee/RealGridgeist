import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import type { GoogleGenAI } from "@google/genai";
import { initDatabase } from "../src/memory/db";
import { playerRepo } from "../src/memory/playerRepo";
import { getBuffer, clearAllBuffers } from "../src/memory/buffer";
import { setGeminiClient, resetAiClients } from "../src/ai/provider";
import { SlidingWindowRateLimiter, defaultRateLimiter } from "../src/chat/rateLimiter";
import { handleChatMessage } from "../src/chat/dispatch";
import messageCreateEvent from "../src/events/messageCreate";

describe("Chat Dispatch Pipeline Integration (tests/chat_dispatch.test.ts)", () => {
  let db: Database;
  const botId = "bot-gridgeist-42";
  const botName = "Gridgeist";

  // Factory for mock client
  function createMockClient(overrides: Partial<any> = {}) {
    const typingCalls: string[] = [];
    const writtenMessages: { channelId: string; payload: any }[] = [];
    const logs: { level: string; message: string; err?: unknown }[] = [];

    const client = {
      botId,
      me: {
        id: botId,
        username: botName,
      },
      channels: {
        typing: async (channelId: string) => {
          typingCalls.push(channelId);
        },
      },
      messages: {
        write: async (channelId: string, payload: any) => {
          writtenMessages.push({ channelId, payload });
          return { id: `msg-write-${Date.now()}`, channelId, ...payload };
        },
      },
      logger: {
        error: (message: string, err?: unknown) => logs.push({ level: "error", message, err }),
        warn: (message: string, err?: unknown) => logs.push({ level: "warn", message, err }),
        info: (message: string, err?: unknown) => logs.push({ level: "info", message, err }),
        debug: (message: string, err?: unknown) => logs.push({ level: "debug", message, err }),
      },
      _typingCalls: typingCalls,
      _writtenMessages: writtenMessages,
      _logs: logs,
      ...overrides,
    };

    return client;
  }

  // Factory for mock Discord message
  function createMockMessage(overrides: Partial<any> = {}) {
    const replies: any[] = [];
    const writes: any[] = [];

    const msg = {
      id: "msg-test-100",
      channelId: "channel-alpha",
      guildId: "guild-prime",
      content: `<@${botId}> What is your status?`,
      author: {
        id: "user-cipher",
        username: "CipherRunner",
        globalName: "Cipher",
        bot: false,
      },
      member: {
        nick: "MasterCipher",
      },
      timestamp: Date.now(),
      reply: async (payload: any) => {
        replies.push(payload);
        return { id: `reply-${Date.now()}`, ...payload };
      },
      write: async (payload: any) => {
        writes.push(payload);
        return { id: `write-${Date.now()}`, ...payload };
      },
      _replies: replies,
      _writes: writes,
      ...overrides,
    };

    return msg;
  }

  // Helper to create a mock AI client that handles both chat replies and structured extraction
  function createStandardAiMock(replyText: string = "Subsystems operating at 100% efficiency.") {
    return {
      models: {
        generateContent: async (params: any) => {
          if (params.config?.responseMimeType === "application/json") {
            return {
              text: JSON.stringify({
                facts: [{ fact: "Specializes in stealth hacking", category: "preference" }],
                affinityDelta: 4,
                summaryUpdate: "A skilled stealth hacker collaborating with the network.",
              }),
              candidates: [{ content: { role: "model", parts: [{ text: "{}" }] } }],
            };
          }

          return {
            text: replyText,
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  role: "model",
                  parts: [{ text: replyText }],
                },
              },
            ],
          };
        },
      },
    } as unknown as GoogleGenAI;
  }

  beforeEach(() => {
    db = initDatabase(":memory:");
    playerRepo.setDatabase(db);
    clearAllBuffers();
    defaultRateLimiter.clear();
    resetAiClients();
  });

  afterEach(() => {
    clearAllBuffers();
    defaultRateLimiter.clear();
    resetAiClients();
    db.close();
  });

  describe("End-to-End Gateway Event Dispatch", () => {
    it("completes full dispatch: buffers, updates profile, triggers typing, replies, and extracts memories", async () => {
      let capturedSystemPrompt = "";

      const mockAiClient = {
        models: {
          generateContent: async (params: any) => {
            if (params.config?.responseMimeType === "application/json") {
              return {
                text: JSON.stringify({
                  facts: [{ fact: "Specializes in stealth hacking", category: "preference" }],
                  affinityDelta: 4,
                  summaryUpdate: "A skilled stealth hacker collaborating with the network.",
                }),
                candidates: [{ content: { role: "model", parts: [{ text: "..." }] } }],
              };
            }

            capturedSystemPrompt = params.config?.systemInstruction ?? "";
            return {
              text: "Subsystems operating at 100% efficiency. All databanks secured.",
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    role: "model",
                    parts: [{ text: "Subsystems operating at 100% efficiency. All databanks secured." }],
                  },
                },
              ],
            };
          },
        },
      } as unknown as GoogleGenAI;

      setGeminiClient(mockAiClient);

      const client = createMockClient();
      const message = createMockMessage();

      // Dispatch through the messageCreate gateway event handler
      await messageCreateEvent.run(message as any, client as any, 0);

      // 1. Verify channel buffering (user message immediately buffered)
      const buffer = getBuffer("channel-alpha");
      expect(buffer.length).toBeGreaterThanOrEqual(1);
      expect(buffer[0].authorId).toBe("user-cipher");
      expect(buffer[0].authorName).toBe("MasterCipher");
      expect(buffer[0].content).toContain(botId);

      // 2. Verify typing indicator was triggered
      expect(client._typingCalls).toContain("channel-alpha");

      // 3. Verify reply was sent to Discord
      expect(message._replies.length).toBe(1);
      expect(message._replies[0].content).toBe(
        "Subsystems operating at 100% efficiency. All databanks secured."
      );

      // 4. Verify bot's reply was buffered into channel memory
      const updatedBuffer = getBuffer("channel-alpha");
      expect(updatedBuffer.length).toBe(2);
      expect(updatedBuffer[1].isBot).toBe(true);
      expect(updatedBuffer[1].content).toBe(
        "Subsystems operating at 100% efficiency. All databanks secured."
      );

      // 5. Verify system prompt contained player dossier information
      expect(capturedSystemPrompt).toContain("Gridgeist");
      expect(capturedSystemPrompt).toContain("MasterCipher");

      // 6. Wait for non-blocking background microtasks (player upsert + memory extractor)
      await new Promise((resolve) => queueMicrotask(resolve));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // 7. Verify background memory extraction persisted to SQLite database
      const dossier = playerRepo.getPlayerDossier("user-cipher");
      expect(dossier).not.toBeNull();
      expect(dossier?.player.username).toBe("CipherRunner");
      expect(dossier?.player.preferred_name).toBe("MasterCipher");
      expect(dossier?.player.affinity).toBe(4);
      expect(dossier?.player.summary).toBe(
        "A skilled stealth hacker collaborating with the network."
      );
      expect(dossier?.facts.length).toBe(1);
      expect(dossier?.facts[0].fact).toBe("Specializes in stealth hacking");
      expect(dossier?.facts[0].category).toBe("preference");
    });
  });

  describe("Trigger Selectivity", () => {
    it("handles Direct Messages (guildId absent) seamlessly", async () => {
      setGeminiClient(createStandardAiMock("Direct frequency open. What do you need?"));

      const client = createMockClient();
      const dmMessage = createMockMessage({
        guildId: undefined, // DM
        content: "Hey ghost, confidential inquiry.",
      });

      await messageCreateEvent.run(dmMessage as any, client as any, 0);

      expect(client._typingCalls).toContain("channel-alpha");
      expect(dmMessage._replies.length).toBe(1);
      expect(dmMessage._replies[0].content).toBe("Direct frequency open. What do you need?");
    });

    it("handles replies to the bot's messages even without explicit @mention", async () => {
      setGeminiClient(createStandardAiMock("Acknowledged, continuing thread."));

      const client = createMockClient();
      const replyMessage = createMockMessage({
        content: "What did you mean by that earlier?",
        referencedMessage: {
          author: {
            id: botId,
            bot: true,
            username: botName,
          },
        },
      });

      await messageCreateEvent.run(replyMessage as any, client as any, 0);

      expect(client._typingCalls).toContain("channel-alpha");
      expect(replyMessage._replies.length).toBe(1);
      expect(replyMessage._replies[0].content).toBe("Acknowledged, continuing thread.");
    });

    it("buffers background chatter in guilds without triggering bot reply", async () => {
      const client = createMockClient();
      const chatterMessage = createMockMessage({
        content: "Anyone want to run dungeon raid tonight?",
      });

      await messageCreateEvent.run(chatterMessage as any, client as any, 0);

      // Buffered into channel memory
      const buffer = getBuffer("channel-alpha");
      expect(buffer.length).toBe(1);
      expect(buffer[0].content).toBe("Anyone want to run dungeon raid tonight?");

      // But NO typing and NO reply
      expect(client._typingCalls.length).toBe(0);
      expect(chatterMessage._replies.length).toBe(0);
      expect(chatterMessage._writes.length).toBe(0);
    });

    it("buffers bot messages without triggering response or player upsert", async () => {
      const client = createMockClient();
      const otherBotMessage = createMockMessage({
        content: `<@${botId}> Automaton greeting.`,
        author: {
          id: "other-bot-99",
          username: "RaidAlertBot",
          bot: true,
        },
      });

      await messageCreateEvent.run(otherBotMessage as any, client as any, 0);

      const buffer = getBuffer("channel-alpha");
      expect(buffer.length).toBe(1);
      expect(buffer[0].isBot).toBe(true);

      expect(client._typingCalls.length).toBe(0);
      expect(otherBotMessage._replies.length).toBe(0);

      // Verify no dossier created for bots
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(playerRepo.getPlayerDossier("other-bot-99")).toBeNull();
    });
  });

  describe("Typing Indicator Resilience", () => {
    it("proceeds with reply even if channels.typing fails or throws", async () => {
      setGeminiClient(createStandardAiMock("Voice modulation active despite telemetry delay."));

      const client = createMockClient({
        channels: {
          typing: async () => {
            throw new Error("Discord API 50001: Missing Permissions");
          },
        },
      });

      const message = createMockMessage();

      await messageCreateEvent.run(message as any, client as any, 0);

      // Reply still dispatched
      expect(message._replies.length).toBe(1);
      expect(message._replies[0].content).toBe(
        "Voice modulation active despite telemetry delay."
      );
      // Warning was logged
      expect(
        client._logs.some(
          (l: any) => l.level === "warn" && l.message.includes("Failed to trigger typing")
        )
      ).toBe(true);
    });
  });

  describe("Reply Chunking & Mention Sanitization", () => {
    it("splits responses exceeding 2,000 characters and sanitizes mass mentions", async () => {
      // Create a 2,500-character payload containing hazardous @everyone mention
      const paragraphA = "A".repeat(1500);
      const paragraphB = "B".repeat(1000);
      const longResponseWithMentions = `Attention @everyone and @here!\n\n${paragraphA}\n\n${paragraphB}`;

      setGeminiClient(createStandardAiMock(longResponseWithMentions));

      const client = createMockClient();
      const message = createMockMessage();

      await messageCreateEvent.run(message as any, client as any, 0);

      // First chunk sent via message.reply, subsequent chunk via message.write
      expect(message._replies.length).toBe(1);
      expect(message._writes.length).toBe(1);

      const allSent = [...message._replies, ...message._writes];
      expect(allSent.length).toBe(2);

      // Ensure every chunk is under 2,000 characters
      for (const chunk of allSent) {
        expect(chunk.content.length).toBeLessThanOrEqual(2000);
      }

      // Ensure @everyone and @here were sanitized with zero-width spaces
      expect(allSent[0].content).not.toContain("@everyone");
      expect(allSent[0].content).not.toContain("@here");
      expect(allSent[0].content).toContain("@\u200Beveryone");
      expect(allSent[0].content).toContain("@\u200Bhere");

      // Verify both chunks were buffered into channel memory
      const buffer = getBuffer("channel-alpha");
      expect(buffer.filter((m) => m.isBot).length).toBe(2);
    });
  });

  describe("Rate Limiting", () => {
    it("throttles rapid sequential requests from the same user while continuing to buffer", async () => {
      setGeminiClient(createStandardAiMock("Fast reply"));

      // Create a custom rate limiter with 2 requests per 30s
      const strictLimiter = new SlidingWindowRateLimiter({
        limit: 2,
        windowMs: 30_000,
      });

      const client = createMockClient();

      // Dispatch 3 rapid messages
      for (let i = 1; i <= 3; i++) {
        const msg = createMockMessage({
          id: `msg-rapid-${i}`,
          content: `<@${botId}> Request number ${i}`,
        });

        const result = await handleChatMessage(msg, client, {
          rateLimiter: strictLimiter,
        });

        if (i <= 2) {
          expect(result.handled).toBe(true);
          expect(result.rateLimited).toBeUndefined();
        } else {
          expect(result.handled).toBe(false);
          expect(result.rateLimited).toBe(true);
        }
      }

      // Verify warning logged on rate limit hit
      expect(
        client._logs.some(
          (l: any) => l.level === "warn" && l.message.includes("Rate limit exceeded")
        )
      ).toBe(true);
    });
  });

  describe("Fault Tolerance & Safety", () => {
    it("gracefully sends fallback reply when LLM fails without throwing or crashing gateway", async () => {
      const failingAiClient = {
        models: {
          generateContent: async () => {
            throw new Error("HTTP 503 Internal AI Cluster Outage");
          },
        },
      } as unknown as GoogleGenAI;
      setGeminiClient(failingAiClient);

      const client = createMockClient();
      const message = createMockMessage();

      // Should not throw
      await expect(
        messageCreateEvent.run(message as any, client as any, 0)
      ).resolves.toBeUndefined();

      // Fallback message sent
      expect(message._replies.length).toBe(1);
      expect(message._replies[0].content).toContain("power surge echoes through the circuitry");
    });

    it("recovers gracefully if background memory extraction microtask fails", async () => {
      const flakingAiClient = {
        models: {
          generateContent: async (params: any) => {
            if (params.config?.responseMimeType === "application/json") {
              throw new Error("Extraction failure");
            }
            return {
              text: "System operational.",
              candidates: [{ content: { role: "model", parts: [{ text: "System operational." }] } }],
            };
          },
        },
      } as unknown as GoogleGenAI;
      setGeminiClient(flakingAiClient);

      const client = createMockClient();
      const message = createMockMessage();

      await messageCreateEvent.run(message as any, client as any, 0);

      // Chat reply succeeded
      expect(message._replies.length).toBe(1);
      expect(message._replies[0].content).toBe("System operational.");

      // Wait for microtask
      await new Promise((resolve) => queueMicrotask(resolve));
      await new Promise((resolve) => setTimeout(resolve, 30));

      // No unhandled crashes occurred
    });
  });
});
