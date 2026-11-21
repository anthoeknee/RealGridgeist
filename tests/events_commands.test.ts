import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase, closeDatabase } from "../src/memory/db";
import { playerRepo } from "../src/memory/playerRepo";
import { getBuffer, clearAllBuffers } from "../src/memory/buffer";
import messageCreateEvent from "../src/events/messageCreate";
import ForgetCommand from "../src/commands/forget";
import type { MessageStructure } from "seyfert/lib/client/transformers";
import type { UsingClient } from "seyfert/lib/commands";
import type { CommandContext } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";

describe("Events & Commands Integration", () => {
  let db: Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    playerRepo.setDatabase(db);
    clearAllBuffers();
  });

  afterEach(() => {
    clearAllBuffers();
    db.close();
  });

  describe("messageCreate Gateway Event", () => {
    const fakeClient = {
      logger: {
        error: () => {},
        info: () => {},
        warn: () => {},
      },
    } as unknown as UsingClient;

    it("buffers incoming message and asynchronously upserts human player", async () => {
      const mockMessage = {
        channelId: "1001",
        content: "Hello ghost!",
        author: {
          id: "player-42",
          username: "AliceGamer",
          globalName: "Alice",
          bot: false,
        },
        member: {
          nick: "AliceInChains",
        },
        timestamp: Date.now(),
      } as unknown as MessageStructure;

      messageCreateEvent.run(mockMessage, fakeClient, 0);

      // Verify immediate short-term buffer storage
      const buffer = getBuffer("1001");
      expect(buffer).toHaveLength(1);
      expect(buffer[0].authorId).toBe("player-42");
      expect(buffer[0].authorName).toBe("AliceInChains");
      expect(buffer[0].content).toBe("Hello ghost!");
      expect(buffer[0].isBot).toBe(false);

      // Wait for background microtask player upsert
      await new Promise((resolve) => queueMicrotask(resolve));

      const dossier = playerRepo.getPlayerDossier("player-42");
      expect(dossier).not.toBeNull();
      expect(dossier?.player.username).toBe("AliceGamer");
      expect(dossier?.player.preferred_name).toBe("AliceInChains");
      expect(dossier?.player.interaction_count).toBe(1);
    });

    it("buffers bot messages without upserting a player dossier", async () => {
      const mockBotMessage = {
        channelId: "1002",
        content: "Beep boop",
        author: {
          id: "bot-99",
          username: "OtherBot",
          bot: true,
        },
        timestamp: Date.now(),
      } as unknown as MessageStructure;

      messageCreateEvent.run(mockBotMessage, fakeClient, 0);

      const buffer = getBuffer("1002");
      expect(buffer).toHaveLength(1);
      expect(buffer[0].isBot).toBe(true);

      await new Promise((resolve) => queueMicrotask(resolve));

      const dossier = playerRepo.getPlayerDossier("bot-99");
      expect(dossier).toBeNull();
    });

    it("correctly extracts replyToAuthorName from referencedMessage", () => {
      const mockReplyMessage = {
        channelId: "1003",
        content: "I agree with you",
        author: {
          id: "player-50",
          username: "Bob",
          bot: false,
        },
        referencedMessage: {
          author: {
            username: "Alice",
          },
        },
        timestamp: Date.now(),
      } as unknown as MessageStructure;

      messageCreateEvent.run(mockReplyMessage, fakeClient, 0);

      const buffer = getBuffer("1003");
      expect(buffer).toHaveLength(1);
      expect(buffer[0].replyToAuthorName).toBe("Alice");
    });
  });

  describe("ForgetCommand (/forget)", () => {
    it("deletes user profile and responds ephemerally", async () => {
      // Setup an existing player with facts
      playerRepo.upsertPlayer({
        user_id: "user-to-forget",
        username: "ForgetMe",
      });
      playerRepo.addFact("user-to-forget", "Loves dragons");

      expect(playerRepo.getPlayerDossier("user-to-forget")).not.toBeNull();

      let writePayload: any = null;
      const mockCtx = {
        author: {
          id: "user-to-forget",
        },
        write: async (payload: any) => {
          writePayload = payload;
        },
      } as unknown as CommandContext;

      const command = new ForgetCommand();
      await command.run(mockCtx);

      // Verify deletion
      expect(playerRepo.getPlayerDossier("user-to-forget")).toBeNull();
      expect(writePayload).not.toBeNull();
      expect(writePayload.content).toContain("permanently deleted");
      expect(writePayload.flags).toBe(MessageFlags.Ephemeral);
    });

    it("informs user if no dossier exists", async () => {
      let writePayload: any = null;
      const mockCtx = {
        author: {
          id: "unknown-user",
        },
        write: async (payload: any) => {
          writePayload = payload;
        },
      } as unknown as CommandContext;

      const command = new ForgetCommand();
      await command.run(mockCtx);

      expect(writePayload).not.toBeNull();
      expect(writePayload.content).toContain("don't have any recorded dossier");
      expect(writePayload.flags).toBe(MessageFlags.Ephemeral);
    });
  });
});
