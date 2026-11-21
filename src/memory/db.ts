import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { env } from "../env";

/**
 * Idempotently creates tables and indices for persistent memory.
 */
export function runMigrations(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      preferred_name TEXT,
      affinity INTEGER NOT NULL DEFAULT 0 CHECK (affinity >= -100 AND affinity <= 100),
      interaction_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES players(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bot_mood (
      guild_id TEXT PRIMARY KEY,
      energy INTEGER NOT NULL DEFAULT 50 CHECK (energy >= 0 AND energy <= 100),
      warmth INTEGER NOT NULL DEFAULT 50 CHECK (warmth >= 0 AND warmth <= 100),
      sarcasm INTEGER NOT NULL DEFAULT 50 CHECK (sarcasm >= 0 AND sarcasm <= 100),
      current_vibe TEXT NOT NULL DEFAULT 'neutral',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_scopes (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id, scope)
    );

    CREATE INDEX IF NOT EXISTS idx_player_facts_user_id ON player_facts(user_id);
    CREATE INDEX IF NOT EXISTS idx_player_facts_user_fact ON player_facts(user_id, fact);
    CREATE INDEX IF NOT EXISTS idx_player_facts_recent ON player_facts(user_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_role_scopes_guild ON role_scopes(guild_id);
  `);
}

/**
 * Opens a SQLite database at the specified path (or env.DATABASE_PATH by default),
 * creates the parent directory if missing, sets WAL mode and foreign keys,
 * and runs idempotent migrations.
 */
export function initDatabase(dbPath: string = env.DATABASE_PATH): Database {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const database = new Database(dbPath);
  database.run("PRAGMA journal_mode = WAL;");
  database.run("PRAGMA foreign_keys = ON;");

  runMigrations(database);

  return database;
}

let defaultDbInstance: Database | null = null;

/**
 * Gets or initializes the singleton Database instance.
 */
export function getDatabase(): Database {
  if (!defaultDbInstance) {
    defaultDbInstance = initDatabase();
  }
  return defaultDbInstance;
}

/**
 * Closes the singleton Database instance, if open.
 */
export function closeDatabase(): void {
  if (defaultDbInstance) {
    defaultDbInstance.close();
    defaultDbInstance = null;
  }
}

/**
 * Default database instance accessed lazily via Proxy.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = getDatabase();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
