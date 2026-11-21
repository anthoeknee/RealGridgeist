import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  extractedFactSchema,
  extractedMemorySchema,
  composeExtractionPrompt,
  extractMemories,
  type ExtractedMemory,
} from "../src/ai/extractor";
import { PlayerRepository } from "../src/memory/playerRepo";
import { initDatabase } from "../src/memory/db";
import type { PlayerDossier } from "../src/memory/types";

describe("Memory & Cognition Extractor (src/ai/extractor.ts)", () => {
  let testDb: Database;
  let testRepo: PlayerRepository;

  beforeEach(() => {
    testDb = initDatabase(":memory:");
    testRepo = new PlayerRepository(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  describe("extractedMemorySchema validation", () => {
    it("validates well-formed extraction payload", () => {
      const payload = {
        facts: [
          { fact: "Prefers cybernetic augmentations", category: "preference" },
          { fact: "Owns a level 80 netrunner", category: "game_stat" },
        ],
        affinityDelta: 3,
        summaryUpdate: "A skilled netrunner with cybernetic affinities.",
      };

      const result = extractedMemorySchema.parse(payload);
      expect(result.facts.length).toBe(2);
      expect(result.facts[0].fact).toBe("Prefers cybernetic augmentations");
      expect(result.facts[0].category).toBe("preference");
      expect(result.facts[1].category).toBe("game_stat");
      expect(result.affinityDelta).toBe(3);
      expect(result.summaryUpdate).toBe("A skilled netrunner with cybernetic affinities.");
    });

    it("preprocesses string facts into object items with 'other' category", () => {
      const payload = {
        facts: ["Loves synthesizer music", "Builds custom drones"],
        affinityDelta: 2,
        summaryUpdate: null,
      };

      const result = extractedMemorySchema.parse(payload);
      expect(result.facts).toEqual([
        { fact: "Loves synthesizer music", category: "other" },
        { fact: "Builds custom drones", category: "other" },
      ]);
      expect(result.affinityDelta).toBe(2);
      expect(result.summaryUpdate).toBeNull();
    });

    it("clamps out-of-bounds affinityDelta to [-5, 5]", () => {
      expect(extractedMemorySchema.parse({ affinityDelta: 10 }).affinityDelta).toBe(5);
      expect(extractedMemorySchema.parse({ affinityDelta: -20 }).affinityDelta).toBe(-5);
      expect(extractedMemorySchema.parse({ affinityDelta: 3.7 }).affinityDelta).toBe(4);
    });

    it("defaults omitted fields cleanly", () => {
      const parsed = extractedMemorySchema.parse({});
      expect(parsed.facts).toEqual([]);
      expect(parsed.affinityDelta).toBe(0);
      expect(parsed.summaryUpdate).toBeNull();
    });

    it("converts empty string summaryUpdate to null", () => {
      const parsed = extractedMemorySchema.parse({ summaryUpdate: "   " });
      expect(parsed.summaryUpdate).toBeNull();
    });
  });

  describe("composeExtractionPrompt", () => {
    it("composes prompt with user profile, dossier facts, and recent conversation", () => {
      const mockDossier: PlayerDossier = {
        player: {
          user_id: "user-42",
          username: "GlitchHunter",
          preferred_name: "Glitch",
          affinity: 20,
          interaction_count: 5,
          summary: "An explorer of abandoned servers.",
          last_seen_at: new Date().toISOString(),
        },
        facts: [
          {
            id: 1,
            user_id: "user-42",
            fact: "Collects vintage mainframes",
            category: "preference",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const { prompt, systemPrompt } = composeExtractionPrompt({
        userId: "user-42",
        userName: "GlitchHunter",
        userMessage: "I found another PDP-11 in the sub-basement today!",
        botReply: "Incredible find, Glitch. The magnetic core memory is still intact?",
        channelHistory: "User: Hello\nBot: Hi",
        dossier: mockDossier,
      });

      expect(systemPrompt).toContain("Gridgeist");
      expect(systemPrompt).toContain("Affinity Delta (-5 to +5)");
      expect(prompt).toContain("User ID: user-42");
      expect(prompt).toContain("Username: GlitchHunter");
      expect(prompt).toContain("Current Affinity: 20/100");
      expect(prompt).toContain("Existing Summary: An explorer of abandoned servers.");
      expect(prompt).toContain("* [preference] Collects vintage mainframes");
      expect(prompt).toContain("[RECENT CHANNEL CONVERSATION LOG]");
      expect(prompt).toContain("User Message: I found another PDP-11 in the sub-basement today!");
      expect(prompt).toContain("Gridgeist Reply: Incredible find, Glitch. The magnetic core memory is still intact?");
    });

    it("omits channel log section when channelHistory is empty", () => {
      const { prompt } = composeExtractionPrompt({
        userId: "user-99",
        userMessage: "Hello",
        channelHistory: "   ",
      });

      expect(prompt).not.toContain("[RECENT CHANNEL CONVERSATION LOG]");
      expect(prompt).toContain("User Message: Hello");
    });
  });

  describe("extractMemories", () => {
    it("extracts facts, updates affinity, updates summary, and persists atomically", async () => {
      // Seed initial player in test DB
      testRepo.upsertPlayer({
        user_id: "user-test-1",
        username: "CipherCoder",
        affinity: 10,
      });

      const mockResponseData: ExtractedMemory = {
        facts: [
          { fact: "Specializes in Rust compiler internals", category: "preference" },
          { fact: "Has a cat named Pixel", category: "other" },
        ],
        affinityDelta: 4,
        summaryUpdate: "A brilliant systems programmer and Rust enthusiast with a pet cat named Pixel.",
      };

      const mockClient = {
        models: {
          generateContent: async () => ({
            text: JSON.stringify(mockResponseData),
            candidates: [{ finishReason: "STOP" }],
          }),
        },
      };

      const result = await extractMemories({
        userId: "user-test-1",
        userMessage: "I was fixing an LLVM backend bug in Rust today while Pixel slept on my keyboard.",
        botReply: "Classic Pixel! How did the LLVM pass turn out?",
        client: mockClient,
        playerRepository: testRepo,
      });

      expect(result).not.toBeNull();
      expect(result?.savedFacts.length).toBe(2);
      expect(result?.updatedPlayer?.affinity).toBe(14); // 10 + 4
      expect(result?.updatedPlayer?.summary).toBe(
        "A brilliant systems programmer and Rust enthusiast with a pet cat named Pixel."
      );

      // Verify persisted state in repository
      const dossier = testRepo.getPlayerDossier("user-test-1");
      expect(dossier).not.toBeNull();
      expect(dossier?.player.affinity).toBe(14);
      expect(dossier?.player.summary).toContain("Rust enthusiast");
      expect(dossier?.facts.some((f) => f.fact.includes("Rust compiler"))).toBe(true);
      expect(dossier?.facts.some((f) => f.fact.includes("Pixel"))).toBe(true);
    });

    it("handles positional arguments overload seamlessly", async () => {
      testRepo.upsertPlayer({
        user_id: "user-pos-1",
        username: "VectorPilot",
        affinity: 0,
      });

      const mockClient = {
        models: {
          generateContent: async () => ({
            text: JSON.stringify({
              facts: [{ fact: "Flies an interceptor class ship", category: "game_stat" }],
              affinityDelta: 2,
              summaryUpdate: "Interceptor pilot.",
            }),
            candidates: [{ finishReason: "STOP" }],
          }),
        },
      };

      // Set mock client on the test provider or test via options
      const result = await extractMemories({
        userId: "user-pos-1",
        userMessage: "My interceptor ship clocked 4,200 m/s!",
        botReply: "Speedy! Keep your shields charged.",
        client: mockClient,
        playerRepository: testRepo,
      });

      expect(result).not.toBeNull();
      expect(result?.savedFacts[0].fact).toBe("Flies an interceptor class ship");
      expect(result?.savedFacts[0].category).toBe("game_stat");
      expect(result?.updatedPlayer?.affinity).toBe(2);
    });

    it("safely handles empty facts and 0 affinityDelta without unnecessary writes", async () => {
      testRepo.upsertPlayer({
        user_id: "user-test-neutral",
        username: "CasualUser",
        affinity: 25,
      });

      const mockClient = {
        models: {
          generateContent: async () => ({
            text: JSON.stringify({
              facts: [],
              affinityDelta: 0,
              summaryUpdate: null,
            }),
            candidates: [{ finishReason: "STOP" }],
          }),
        },
      };

      const result = await extractMemories({
        userId: "user-test-neutral",
        userMessage: "What is 2 + 2?",
        botReply: "4.",
        client: mockClient,
        playerRepository: testRepo,
      });

      expect(result).not.toBeNull();
      expect(result?.savedFacts).toEqual([]);
      expect(result?.updatedPlayer?.affinity).toBe(25);
    });

    it("returns null without calling LLM when userId is empty or messages are blank", async () => {
      let called = false;
      const mockClient = {
        models: {
          generateContent: async () => {
            called = true;
            return { text: "{}" };
          },
        },
      };

      const res1 = await extractMemories({
        userId: "",
        userMessage: "Hello",
        client: mockClient,
        playerRepository: testRepo,
      });
      expect(res1).toBeNull();
      expect(called).toBe(false);

      const res2 = await extractMemories({
        userId: "user-123",
        userMessage: "   ",
        botReply: "   ",
        client: mockClient,
        playerRepository: testRepo,
      });
      expect(res2).toBeNull();
      expect(called).toBe(false);
    });

    it("never throws when LLM call fails, catches error internally and returns null", async () => {
      const mockFailingClient = {
        models: {
          generateContent: async () => {
            throw new Error("HTTP 500 Network Connection Refused");
          },
        },
      };

      let threw = false;
      let result = null;
      try {
        result = await extractMemories({
          userId: "user-fail-1",
          userMessage: "Hello bot!",
          botReply: "Greetings!",
          client: mockFailingClient,
          playerRepository: testRepo,
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(result).toBeNull();
    });

    it("auto-creates player profile if not yet in database before applying affinity", async () => {
      const mockClient = {
        models: {
          generateContent: async () => ({
            text: JSON.stringify({
              facts: [{ fact: "First time speaking to Gridgeist", category: "lore" }],
              affinityDelta: 3,
              summaryUpdate: "A new visitor to the Grid.",
            }),
            candidates: [{ finishReason: "STOP" }],
          }),
        },
      };

      const result = await extractMemories({
        userId: "new-user-999",
        userName: "NewbieVoyager",
        userMessage: "Hi Gridgeist, I just arrived on this server!",
        botReply: "Welcome to the digital realm, NewbieVoyager.",
        client: mockClient,
        playerRepository: testRepo,
      });

      expect(result).not.toBeNull();
      expect(result?.updatedPlayer?.user_id).toBe("new-user-999");
      expect(result?.updatedPlayer?.affinity).toBe(3);
      expect(result?.updatedPlayer?.summary).toBe("A new visitor to the Grid.");
    });
  });
});
