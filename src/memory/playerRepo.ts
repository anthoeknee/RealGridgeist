import { Database, Statement } from "bun:sqlite";
import { getDatabase } from "./db";
import type {
  Player,
  PlayerFact,
  PlayerDossier,
  FactCategory,
  FactInput,
  UpsertPlayerInput,
  BotMood,
  UpsertBotMoodInput,
} from "./types";

export class PlayerRepository {
  private db: Database;

  // Prepared Statements
  private stmtUpsertPlayer: Statement;
  private stmtGetPlayer: Statement;
  private stmtGetRecentFacts: Statement;
  private stmtFindFact: Statement;
  private stmtInsertFact: Statement;
  private stmtUpdateFact: Statement;
  private stmtAdjustAffinity: Statement;
  private stmtSetAffinity: Statement;
  private stmtUpdatePreferredName: Statement;
  private stmtUpdateSummary: Statement;
  private stmtDeleteFactsByUser: Statement;
  private stmtDeletePlayer: Statement;
  private stmtGetBotMood: Statement;
  private stmtUpsertBotMood: Statement;

  // Transactions
  private txAddFactsAndAdjustAffinity: (
    userId: string,
    facts: FactInput[],
    affinityDelta?: number,
  ) => { player: Player | null; facts: PlayerFact[] };
  private txDeletePlayer: (userId: string) => boolean;

  constructor(database?: Database) {
    this.db = database ?? getDatabase();

    // 1. Player statements
    this.stmtUpsertPlayer = this.db.prepare(`
      INSERT INTO players (
        user_id,
        username,
        preferred_name,
        affinity,
        interaction_count,
        summary,
        last_seen_at
      )
      VALUES ($user_id, $username, $preferred_name, $affinity, 1, $summary, $last_seen_at)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        preferred_name = COALESCE(excluded.preferred_name, players.preferred_name),
        interaction_count = players.interaction_count + 1,
        summary = COALESCE(excluded.summary, players.summary),
        last_seen_at = excluded.last_seen_at
      RETURNING *;
    `);

    this.stmtGetPlayer = this.db.prepare(`
      SELECT * FROM players WHERE user_id = $user_id;
    `);

    this.stmtAdjustAffinity = this.db.prepare(`
      UPDATE players
      SET
        affinity = MAX(-100, MIN(100, affinity + $delta)),
        last_seen_at = $last_seen_at
      WHERE user_id = $user_id
      RETURNING *;
    `);

    this.stmtSetAffinity = this.db.prepare(`
      UPDATE players
      SET
        affinity = MAX(-100, MIN(100, $affinity)),
        last_seen_at = $last_seen_at
      WHERE user_id = $user_id
      RETURNING *;
    `);

    this.stmtUpdatePreferredName = this.db.prepare(`
      UPDATE players
      SET preferred_name = $preferred_name, last_seen_at = $last_seen_at
      WHERE user_id = $user_id
      RETURNING *;
    `);

    this.stmtUpdateSummary = this.db.prepare(`
      UPDATE players
      SET summary = $summary, last_seen_at = $last_seen_at
      WHERE user_id = $user_id
      RETURNING *;
    `);

    this.stmtDeletePlayer = this.db.prepare(`
      DELETE FROM players WHERE user_id = $user_id;
    `);

    // 2. Fact statements
    this.stmtGetRecentFacts = this.db.prepare(`
      SELECT * FROM player_facts
      WHERE user_id = $user_id
      ORDER BY updated_at DESC, id DESC
      LIMIT $limit;
    `);

    this.stmtFindFact = this.db.prepare(`
      SELECT * FROM player_facts
      WHERE user_id = $user_id AND lower(trim(fact)) = lower(trim($fact))
      LIMIT 1;
    `);

    this.stmtInsertFact = this.db.prepare(`
      INSERT INTO player_facts (user_id, fact, category, created_at, updated_at)
      VALUES ($user_id, $fact, $category, $created_at, $updated_at)
      RETURNING *;
    `);

    this.stmtUpdateFact = this.db.prepare(`
      UPDATE player_facts
      SET updated_at = $updated_at, category = $category
      WHERE id = $id
      RETURNING *;
    `);

    this.stmtDeleteFactsByUser = this.db.prepare(`
      DELETE FROM player_facts WHERE user_id = $user_id;
    `);

    // 3. Bot Mood statements
    this.stmtGetBotMood = this.db.prepare(`
      SELECT * FROM bot_mood WHERE guild_id = $guild_id;
    `);

    this.stmtUpsertBotMood = this.db.prepare(`
      INSERT INTO bot_mood (guild_id, energy, warmth, sarcasm, current_vibe, updated_at)
      VALUES (
        $guild_id,
        COALESCE($energy, 50),
        COALESCE($warmth, 50),
        COALESCE($sarcasm, 50),
        COALESCE($current_vibe, 'neutral'),
        $updated_at
      )
      ON CONFLICT(guild_id) DO UPDATE SET
        energy = COALESCE($energy, bot_mood.energy),
        warmth = COALESCE($warmth, bot_mood.warmth),
        sarcasm = COALESCE($sarcasm, bot_mood.sarcasm),
        current_vibe = COALESCE($current_vibe, bot_mood.current_vibe),
        updated_at = excluded.updated_at
      RETURNING *;
    `);

    // Initialize atomic transactions
    this.txAddFactsAndAdjustAffinity = this.db.transaction(
      (userId: string, facts: FactInput[], affinityDelta?: number) => {
        const processedFacts: PlayerFact[] = [];
        for (const item of facts) {
          const processed = this.addFact(userId, item.fact, item.category);
          processedFacts.push(processed);
        }

        let updatedPlayer: Player | null = null;
        if (affinityDelta !== undefined && affinityDelta !== 0) {
          updatedPlayer = this.adjustAffinity(userId, affinityDelta);
        } else {
          updatedPlayer = this.getPlayer(userId);
        }

        return { player: updatedPlayer, facts: processedFacts };
      },
    );

    this.txDeletePlayer = this.db.transaction((userId: string) => {
      this.stmtDeleteFactsByUser.run({ $user_id: userId });
      const res = this.stmtDeletePlayer.run({ $user_id: userId });
      return res.changes > 0;
    });
  }

  /**
   * Upsert a player profile.
   * On first insert: sets interaction_count to 1 and applies initial affinity (clamped to [-100, 100]).
   * On conflict: increments interaction_count, updates username and last_seen_at, preserves existing affinity.
   */
  public upsertPlayer(input: UpsertPlayerInput): Player {
    const now = input.last_seen_at ?? new Date().toISOString();
    const clampedAffinity = Math.max(-100, Math.min(100, Math.round(input.affinity ?? 0)));

    return this.stmtUpsertPlayer.get({
      $user_id: input.user_id,
      $username: input.username,
      $preferred_name: input.preferred_name ?? null,
      $affinity: clampedAffinity,
      $summary: input.summary ?? null,
      $last_seen_at: now,
    }) as Player;
  }

  /**
   * Fetches a player by user_id, or null if not found.
   */
  public getPlayer(userId: string): Player | null {
    return (this.stmtGetPlayer.get({ $user_id: userId }) as Player | null) ?? null;
  }

  /**
   * Fetches a player's full dossier (profile + top N most relevant/recent facts, default 15).
   * Returns null if player is not found.
   */
  public getPlayerDossier(userId: string, factLimit: number = 15): PlayerDossier | null {
    const player = this.getPlayer(userId);
    if (!player) {
      return null;
    }

    const facts = this.stmtGetRecentFacts.all({
      $user_id: userId,
      $limit: Math.max(1, factLimit),
    }) as PlayerFact[];

    return {
      player,
      facts,
    };
  }

  /**
   * Adds or deduplicates a fact for a player.
   * If a matching fact exists (case-insensitive, trimmed), updates its updated_at timestamp and category.
   * Otherwise, inserts a new fact.
   */
  public addFact(
    userId: string,
    factText: string,
    category: FactCategory = "preference",
  ): PlayerFact {
    const trimmed = factText.trim();
    if (!trimmed) {
      throw new Error("Fact text cannot be empty or whitespace.");
    }

    // Ensure player exists in DB to satisfy foreign key constraints
    if (!this.getPlayer(userId)) {
      this.upsertPlayer({ user_id: userId, username: userId });
    }

    const now = new Date().toISOString();
    const existing = this.stmtFindFact.get({
      $user_id: userId,
      $fact: trimmed,
    }) as PlayerFact | null;

    if (existing) {
      return this.stmtUpdateFact.get({
        $id: existing.id,
        $updated_at: now,
        $category: category ?? existing.category,
      }) as PlayerFact;
    }

    return this.stmtInsertFact.get({
      $user_id: userId,
      $fact: trimmed,
      $category: category,
      $created_at: now,
      $updated_at: now,
    }) as PlayerFact;
  }

  /**
   * Adds and deduplicates multiple facts inside a single transaction.
   */
  public addFacts(userId: string, facts: FactInput[]): PlayerFact[] {
    const tx = this.db.transaction((items: FactInput[]) => {
      const results: PlayerFact[] = [];
      for (const item of items) {
        results.push(this.addFact(userId, item.fact, item.category));
      }
      return results;
    });

    return tx(facts);
  }

  /**
   * Adjusts player affinity safely within [-100, 100].
   * Returns the updated player or null if the player does not exist.
   */
  public adjustAffinity(userId: string, delta: number): Player | null {
    const rounded = Math.round(delta);
    const now = new Date().toISOString();

    const result = this.stmtAdjustAffinity.get({
      $user_id: userId,
      $delta: rounded,
      $last_seen_at: now,
    }) as Player | null;

    return result ?? null;
  }

  /**
   * Sets absolute player affinity safely clamped within [-100, 100].
   */
  public setAffinity(userId: string, affinity: number): Player | null {
    const clamped = Math.max(-100, Math.min(100, Math.round(affinity)));
    const now = new Date().toISOString();

    const result = this.stmtSetAffinity.get({
      $user_id: userId,
      $affinity: clamped,
      $last_seen_at: now,
    }) as Player | null;

    return result ?? null;
  }

  /**
   * Updates a player's preferred name.
   */
  public updatePreferredName(userId: string, preferredName: string | null): Player | null {
    const now = new Date().toISOString();
    const result = this.stmtUpdatePreferredName.get({
      $user_id: userId,
      $preferred_name: preferredName,
      $last_seen_at: now,
    }) as Player | null;

    return result ?? null;
  }

  /**
   * Updates a player's summary.
   */
  public updateSummary(userId: string, summary: string | null): Player | null {
    const now = new Date().toISOString();
    const result = this.stmtUpdateSummary.get({
      $user_id: userId,
      $summary: summary,
      $last_seen_at: now,
    }) as Player | null;

    return result ?? null;
  }

  /**
   * Atomically adds/deduplicates facts and adjusts affinity in a single transaction.
   */
  public addFactsAndAdjustAffinity(
    userId: string,
    facts: FactInput[],
    affinityDelta?: number,
  ): { player: Player | null; facts: PlayerFact[] } {
    return this.txAddFactsAndAdjustAffinity(userId, facts, affinityDelta);
  }

  /**
   * Deletes all data for a user_id (facts and player record).
   * For user privacy and /forget commands.
   * Returns true if user was found and deleted, false otherwise.
   */
  public deletePlayer(userId: string): boolean {
    return this.txDeletePlayer(userId);
  }

  /**
   * Fetches the current mood of the bot for a given guild.
   */
  public getBotMood(guildId: string): BotMood | null {
    return (this.stmtGetBotMood.get({ $guild_id: guildId }) as BotMood | null) ?? null;
  }

  /**
   * Upserts or partially updates the bot's mood for a guild.
   * Automatically clamps energy, warmth, and sarcasm between 0 and 100.
   */
  public upsertBotMood(input: UpsertBotMoodInput): BotMood {
    const now = input.updated_at ?? new Date().toISOString();

    const clampStat = (val: number | undefined) =>
      val !== undefined ? Math.max(0, Math.min(100, Math.round(val))) : null;

    return this.stmtUpsertBotMood.get({
      $guild_id: input.guild_id,
      $energy: clampStat(input.energy),
      $warmth: clampStat(input.warmth),
      $sarcasm: clampStat(input.sarcasm),
      $current_vibe: input.current_vibe ?? null,
      $updated_at: now,
    }) as BotMood;
  }
}

// Default repository instance connected to application DB
export const playerRepo = new PlayerRepository();
