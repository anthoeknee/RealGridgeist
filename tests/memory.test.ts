import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase, runMigrations } from "../src/memory/db";
import { PlayerRepository } from "../src/memory/playerRepo";

describe("Persistent Memory Layer (bun:sqlite)", () => {
  let db: Database;
  let repo: PlayerRepository;

  beforeEach(() => {
    db = initDatabase(":memory:");
    repo = new PlayerRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("Database Initialization & Migrations", () => {
    it("runs migrations idempotently without errors", () => {
      expect(() => {
        runMigrations(db);
        runMigrations(db);
      }).not.toThrow();
    });

    it("creates the required tables", () => {
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('players', 'player_facts', 'bot_mood') ORDER BY name;",
        )
        .all() as Array<{ name: string }>;

      const names = tables.map((t) => t.name);
      expect(names).toEqual(["bot_mood", "player_facts", "players"]);
    });

    it("enforces table CHECK constraints on affinity [-100, 100]", () => {
      expect(() => {
        db.run(
          "INSERT INTO players (user_id, username, affinity, interaction_count, last_seen_at) VALUES ('bad', 'bad', 150, 0, '2026-01-01');",
        );
      }).toThrow();

      expect(() => {
        db.run(
          "INSERT INTO players (user_id, username, affinity, interaction_count, last_seen_at) VALUES ('bad2', 'bad2', -150, 0, '2026-01-01');",
        );
      }).toThrow();
    });

    it("enforces table CHECK constraints on bot_mood [0, 100]", () => {
      expect(() => {
        db.run(
          "INSERT INTO bot_mood (guild_id, energy, warmth, sarcasm, current_vibe, updated_at) VALUES ('g1', 150, 50, 50, 'vibe', '2026-01-01');",
        );
      }).toThrow();

      expect(() => {
        db.run(
          "INSERT INTO bot_mood (guild_id, energy, warmth, sarcasm, current_vibe, updated_at) VALUES ('g2', 50, -10, 50, 'vibe', '2026-01-01');",
        );
      }).toThrow();
    });
  });

  describe("Player Upsert & Interaction Count", () => {
    it("inserts a new player with interaction_count = 1 and default affinity = 0", () => {
      const player = repo.upsertPlayer({
        user_id: "user_101",
        username: "CyberSamurai",
      });

      expect(player.user_id).toBe("user_101");
      expect(player.username).toBe("CyberSamurai");
      expect(player.preferred_name).toBeNull();
      expect(player.affinity).toBe(0);
      expect(player.interaction_count).toBe(1);
      expect(player.summary).toBeNull();
      expect(typeof player.last_seen_at).toBe("string");
    });

    it("increments interaction_count on subsequent upserts and updates username", () => {
      repo.upsertPlayer({
        user_id: "user_101",
        username: "OldName",
      });

      const updated = repo.upsertPlayer({
        user_id: "user_101",
        username: "NewName",
      });

      expect(updated.interaction_count).toBe(2);
      expect(updated.username).toBe("NewName");

      const third = repo.upsertPlayer({
        user_id: "user_101",
        username: "NewName",
      });
      expect(third.interaction_count).toBe(3);
    });

    it("preserves existing affinity and custom fields across standard message upserts", () => {
      repo.upsertPlayer({
        user_id: "user_102",
        username: "Gamer123",
        affinity: 25,
        summary: "Loves RPG games",
        preferred_name: "Gamer",
      });

      // Subsequent interaction without preferred_name or summary
      const second = repo.upsertPlayer({
        user_id: "user_102",
        username: "Gamer123Updated",
      });

      expect(second.interaction_count).toBe(2);
      expect(second.affinity).toBe(25);
      expect(second.preferred_name).toBe("Gamer");
      expect(second.summary).toBe("Loves RPG games");
      expect(second.username).toBe("Gamer123Updated");
    });
  });

  describe("Player Dossier & Recent Facts", () => {
    it("returns null when fetching dossier for a non-existent player", () => {
      const dossier = repo.getPlayerDossier("non_existent");
      expect(dossier).toBeNull();
    });

    it("fetches player profile and top 15 most recent facts in descending order", () => {
      repo.upsertPlayer({ user_id: "user_103", username: "FactCollector" });

      // Add 20 distinct facts
      for (let i = 1; i <= 20; i++) {
        repo.addFact("user_103", `Fact number ${i}`, "game_stat");
      }

      const dossier = repo.getPlayerDossier("user_103");
      expect(dossier).not.toBeNull();
      expect(dossier?.player.user_id).toBe("user_103");
      expect(dossier?.facts.length).toBe(15);

      // Verify descending order by checking that the most recently inserted facts are first
      expect(dossier?.facts[0]?.fact).toBe("Fact number 20");
      expect(dossier?.facts[14]?.fact).toBe("Fact number 6");
    });

    it("allows custom fact limit in dossier retrieval", () => {
      repo.upsertPlayer({ user_id: "user_104", username: "CustomLimit" });
      repo.addFact("user_104", "Fact 1");
      repo.addFact("user_104", "Fact 2");
      repo.addFact("user_104", "Fact 3");

      const dossier = repo.getPlayerDossier("user_104", 2);
      expect(dossier?.facts.length).toBe(2);
    });
  });

  describe("Fact Addition & Deduplication", () => {
    it("adds a fact with proper category and auto-stubs player if missing", () => {
      const fact = repo.addFact("user_105", "Prefers mechanical keyboards", "preference");

      expect(fact.user_id).toBe("user_105");
      expect(fact.fact).toBe("Prefers mechanical keyboards");
      expect(fact.category).toBe("preference");
      expect(fact.id).toBeGreaterThan(0);

      const player = repo.getPlayer("user_105");
      expect(player).not.toBeNull();
      expect(player?.interaction_count).toBe(1);
    });

    it("deduplicates case-insensitive and whitespace-variant facts by updating updated_at", async () => {
      const first = repo.addFact("user_106", "Loves Matcha Latte", "preference");

      // Small delay to ensure timestamp change
      await new Promise((r) => setTimeout(r, 10));

      const second = repo.addFact("user_106", "  loves matcha latte  ", "preference");

      expect(second.id).toBe(first.id);
      expect(new Date(second.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(first.updated_at).getTime(),
      );

      const facts = repo.getPlayerDossier("user_106")?.facts;
      expect(facts?.length).toBe(1);
    });

    it("throws an error when attempting to add empty or whitespace-only facts", () => {
      expect(() => {
        repo.addFact("user_106", "");
      }).toThrow();

      expect(() => {
        repo.addFact("user_106", "   ");
      }).toThrow();
    });

    it("adds multiple facts atomically using addFacts", () => {
      repo.upsertPlayer({ user_id: "user_107", username: "MultiFactUser" });

      const added = repo.addFacts("user_107", [
        { fact: "Main role is Tank", category: "game_stat" },
        { fact: "Favorite color is Neon Green", category: "preference" },
        { fact: "Secretly loves bad puns", category: "inside_joke" },
      ]);

      expect(added.length).toBe(3);
      const dossier = repo.getPlayerDossier("user_107");
      expect(dossier?.facts.length).toBe(3);
    });
  });

  describe("Affinity Clamping & Adjustments", () => {
    it("adjusts affinity safely within [-100, 100]", () => {
      repo.upsertPlayer({ user_id: "user_108", username: "AffinityTester", affinity: 0 });

      const plus20 = repo.adjustAffinity("user_108", 20);
      expect(plus20?.affinity).toBe(20);

      const plus100 = repo.adjustAffinity("user_108", 100);
      expect(plus100?.affinity).toBe(100); // Clamped at +100

      const minus50 = repo.adjustAffinity("user_108", -50);
      expect(minus50?.affinity).toBe(50);

      const minus300 = repo.adjustAffinity("user_108", -300);
      expect(minus300?.affinity).toBe(-100); // Clamped at -100
    });

    it("sets absolute affinity safely within [-100, 100]", () => {
      repo.upsertPlayer({ user_id: "user_109", username: "SetAffinityTester" });

      const set1 = repo.setAffinity("user_109", 75);
      expect(set1?.affinity).toBe(75);

      const setOver = repo.setAffinity("user_109", 150);
      expect(setOver?.affinity).toBe(100);

      const setUnder = repo.setAffinity("user_109", -200);
      expect(setUnder?.affinity).toBe(-100);
    });

    it("returns null when adjusting affinity for a non-existent player", () => {
      const res = repo.adjustAffinity("missing_player", 10);
      expect(res).toBeNull();
    });
  });

  describe("Atomic Combined Operation (addFactsAndAdjustAffinity)", () => {
    it("adds facts and updates affinity inside a single atomic transaction", () => {
      repo.upsertPlayer({
        user_id: "user_110",
        username: "CombinedTester",
        affinity: 10,
      });

      const result = repo.addFactsAndAdjustAffinity(
        "user_110",
        [
          { fact: "Defeated the final boss solo", category: "game_stat" },
          { fact: "Hates losing items upon death", category: "lore" },
        ],
        15,
      );

      expect(result.facts.length).toBe(2);
      expect(result.player?.affinity).toBe(25);

      const dossier = repo.getPlayerDossier("user_110");
      expect(dossier?.player.affinity).toBe(25);
      expect(dossier?.facts.length).toBe(2);
    });
  });

  describe("Player Deletion (/forget Privacy Command)", () => {
    it("completely wipes player profile and all associated facts", () => {
      repo.upsertPlayer({
        user_id: "user_111",
        username: "ForgetMe",
        summary: "Sensitive user details",
      });

      repo.addFact("user_111", "Fact 1");
      repo.addFact("user_111", "Fact 2");

      expect(repo.getPlayerDossier("user_111")?.facts.length).toBe(2);

      const deleted = repo.deletePlayer("user_111");
      expect(deleted).toBe(true);

      // Verify dossier is gone
      expect(repo.getPlayerDossier("user_111")).toBeNull();
      expect(repo.getPlayer("user_111")).toBeNull();

      // Verify facts are deleted directly in the database
      const remainingFacts = db
        .query("SELECT COUNT(*) as count FROM player_facts WHERE user_id = $user_id;")
        .get({ $user_id: "user_111" }) as { count: number };
      expect(remainingFacts.count).toBe(0);
    });

    it("returns false when deleting a non-existent player", () => {
      const deleted = repo.deletePlayer("unknown_id");
      expect(deleted).toBe(false);
    });
  });

  describe("Preferred Name and Summary Updates", () => {
    it("updates preferred name and summary individually", () => {
      repo.upsertPlayer({ user_id: "user_112", username: "OriginalUser" });

      const updatedName = repo.updatePreferredName("user_112", "CoolNick");
      expect(updatedName?.preferred_name).toBe("CoolNick");

      const updatedSummary = repo.updateSummary("user_112", "Veteran guild raider.");
      expect(updatedSummary?.summary).toBe("Veteran guild raider.");
      expect(updatedSummary?.preferred_name).toBe("CoolNick");

      // Clear preferred name
      const clearedName = repo.updatePreferredName("user_112", null);
      expect(clearedName?.preferred_name).toBeNull();
    });
  });

  describe("Bot Mood Repository", () => {
    it("upserts bot mood with defaults and clamps values", () => {
      const initial = repo.upsertBotMood({
        guild_id: "guild_999",
        energy: 80,
      });

      expect(initial.guild_id).toBe("guild_999");
      expect(initial.energy).toBe(80);
      expect(initial.warmth).toBe(50);
      expect(initial.sarcasm).toBe(50);
      expect(initial.current_vibe).toBe("neutral");

      // Partial update with clamping
      const updated = repo.upsertBotMood({
        guild_id: "guild_999",
        energy: 150, // should clamp to 100
        sarcasm: 90,
        current_vibe: "chaotic",
      });

      expect(updated.energy).toBe(100);
      expect(updated.warmth).toBe(50); // Preserved
      expect(updated.sarcasm).toBe(90);
      expect(updated.current_vibe).toBe("chaotic");
    });

    it("fetches bot mood for a guild or returns null", () => {
      expect(repo.getBotMood("empty_guild")).toBeNull();

      repo.upsertBotMood({
        guild_id: "guild_888",
        energy: 70,
        current_vibe: "chill",
      });

      const fetched = repo.getBotMood("guild_888");
      expect(fetched?.current_vibe).toBe("chill");
      expect(fetched?.energy).toBe(70);
    });
  });
});
