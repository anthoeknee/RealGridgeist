import { describe, expect, it } from "bun:test";
import { composeSystemPrompt, getAffinityGuidance, getAffinityTier } from "../src/ai/prompt";
import type { PlayerDossier, BotMood } from "../src/memory/types";

describe("Dynamic System Prompt Composer (src/ai/prompt.ts)", () => {
  describe("getAffinityTier", () => {
    it("categorizes hostile tier (<= -26)", () => {
      expect(getAffinityTier(-100)).toBe("hostile");
      expect(getAffinityTier(-50)).toBe("hostile");
      expect(getAffinityTier(-26)).toBe("hostile");
    });

    it("categorizes neutral tier (-25 to 25)", () => {
      expect(getAffinityTier(-25)).toBe("neutral");
      expect(getAffinityTier(0)).toBe("neutral");
      expect(getAffinityTier(25)).toBe("neutral");
    });

    it("categorizes friendly tier (26 to 75)", () => {
      expect(getAffinityTier(26)).toBe("friendly");
      expect(getAffinityTier(50)).toBe("friendly");
      expect(getAffinityTier(75)).toBe("friendly");
    });

    it("categorizes devoted tier (>= 76)", () => {
      expect(getAffinityTier(76)).toBe("devoted");
      expect(getAffinityTier(90)).toBe("devoted");
      expect(getAffinityTier(100)).toBe("devoted");
    });
  });

  describe("getAffinityGuidance", () => {
    it("returns cold/guarded guidance for hostile affinity (<= -26)", () => {
      expect(getAffinityGuidance(-26)).toContain("negative affinity");
      expect(getAffinityGuidance(-100)).toContain("cold, guarded");
    });

    it("returns neutral/observant guidance for neutral affinity (-25 to 25)", () => {
      expect(getAffinityGuidance(-25)).toContain("neutral affinity");
      expect(getAffinityGuidance(0)).toContain("observant, witty");
      expect(getAffinityGuidance(25)).toContain("neutral affinity");
    });

    it("returns friendly/allied guidance for positive affinity (26 to 75)", () => {
      expect(getAffinityGuidance(26)).toContain("positive affinity");
      expect(getAffinityGuidance(50)).toContain("friendly, helpful");
      expect(getAffinityGuidance(75)).toContain("positive affinity");
    });

    it("returns devoted/inner circle guidance for high affinity (>= 76)", () => {
      expect(getAffinityGuidance(76)).toContain("inner circle");
      expect(getAffinityGuidance(100)).toContain("fiercely loyal");
    });
  });

  describe("composeSystemPrompt", () => {
    it("generates baseline prompt when no context is provided", () => {
      const prompt = composeSystemPrompt();

      expect(prompt).toContain("You are Gridgeist");
      expect(prompt).toContain("[RESPONSE GUIDELINES]");
      expect(prompt).not.toContain("[INTERACTION CONTEXT WITH USER]");
      expect(prompt).not.toContain("[SERVER VIBE & MOOD]");
      expect(prompt).not.toContain("[RECENT CHANNEL CONVERSATION LOG]");
    });

    it("uses custom bot name if provided", () => {
      const prompt = composeSystemPrompt({ botName: "CyberPulse" });
      expect(prompt).toContain("You are CyberPulse");
    });

    it("includes player dossier, facts, and affinity guidance when provided", () => {
      const mockDossier: PlayerDossier = {
        player: {
          user_id: "user-123",
          username: "NeonRider",
          preferred_name: "Neon",
          affinity: 45,
          interaction_count: 12,
          summary: "Skilled hacker and drone racer.",
          last_seen_at: new Date().toISOString(),
        },
        facts: [
          {
            id: 1,
            user_id: "user-123",
            fact: "Prefers plasma rifles over lasers",
            category: "preference",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 2,
            user_id: "user-123",
            fact: "High score of 98,200 in GridRunner",
            category: "game_stat",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const prompt = composeSystemPrompt({ dossier: mockDossier });

      expect(prompt).toContain("[INTERACTION CONTEXT WITH USER]");
      expect(prompt).toContain("Talking to: Neon (username: NeonRider)");
      expect(prompt).toContain("Affinity Score: 45 / 100");
      expect(prompt).toContain("Interaction Count: 12");
      expect(prompt).toContain("Tone Guidance: The user has positive affinity with you.");
      expect(prompt).toContain("Dossier Summary: Skilled hacker and drone racer.");
      expect(prompt).toContain("* [preference] Prefers plasma rifles over lasers");
      expect(prompt).toContain("* [game_stat] High score of 98,200 in GridRunner");
    });

    it("falls back to username when preferred_name is null", () => {
      const mockDossier: PlayerDossier = {
        player: {
          user_id: "user-456",
          username: "ZeroCool",
          preferred_name: null,
          affinity: -50,
          interaction_count: 1,
          summary: null,
          last_seen_at: new Date().toISOString(),
        },
        facts: [],
      };

      const prompt = composeSystemPrompt({ dossier: mockDossier });

      expect(prompt).toContain("Talking to: ZeroCool (username: ZeroCool)");
      expect(prompt).toContain("Tone Guidance: The user has negative affinity with you.");
      expect(prompt).not.toContain("Dossier Summary:");
      expect(prompt).not.toContain("Remembered Facts:");
    });

    it("includes guild mood when provided", () => {
      const mockMood: BotMood = {
        guild_id: "guild-789",
        energy: 85,
        warmth: 30,
        sarcasm: 90,
        current_vibe: "chaotic cyber-rave",
        updated_at: new Date().toISOString(),
      };

      const prompt = composeSystemPrompt({ guildMood: mockMood });

      expect(prompt).toContain("[SERVER VIBE & MOOD]");
      expect(prompt).toContain("Energy: 85/100, Warmth: 30/100, Sarcasm: 90/100");
      expect(prompt).toContain("Current Vibe: chaotic cyber-rave");
    });

    it("includes short-term channel conversation log when provided", () => {
      const formattedLog = "Alice: Hey Gridgeist!\nGridgeist [BOT]: Greetings, Alice.\nAlice: What are you doing?";

      const prompt = composeSystemPrompt({ channelHistoryFormatted: formattedLog });

      expect(prompt).toContain("[RECENT CHANNEL CONVERSATION LOG]");
      expect(prompt).toContain(formattedLog);
    });

    it("omits empty or whitespace channel history", () => {
      const prompt = composeSystemPrompt({ channelHistoryFormatted: "   \n  " });
      expect(prompt).not.toContain("[RECENT CHANNEL CONVERSATION LOG]");
    });
  });
});
