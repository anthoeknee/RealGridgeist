import { z } from "zod";

export const factCategorySchema = z.enum([
  "preference",
  "game_stat",
  "lore",
  "inside_joke",
  "other",
]).or(z.string());

export type FactCategory = z.infer<typeof factCategorySchema>;

export const playerSchema = z.object({
  user_id: z.string().min(1),
  username: z.string().min(1),
  preferred_name: z.string().nullable(),
  affinity: z.number().int().min(-100).max(100).default(0),
  interaction_count: z.number().int().nonnegative().default(0),
  summary: z.string().nullable(),
  last_seen_at: z.string().datetime({ offset: true }).or(z.string()),
});

export type Player = z.infer<typeof playerSchema>;

export const playerFactSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.string().min(1),
  fact: z.string().min(1),
  category: factCategorySchema,
  created_at: z.string().datetime({ offset: true }).or(z.string()),
  updated_at: z.string().datetime({ offset: true }).or(z.string()),
});

export type PlayerFact = z.infer<typeof playerFactSchema>;

export const playerDossierSchema = z.object({
  player: playerSchema,
  facts: z.array(playerFactSchema),
});

export type PlayerDossier = z.infer<typeof playerDossierSchema>;

export const botMoodSchema = z.object({
  guild_id: z.string().min(1),
  energy: z.number().int().min(0).max(100).default(50),
  warmth: z.number().int().min(0).max(100).default(50),
  sarcasm: z.number().int().min(0).max(100).default(50),
  current_vibe: z.string().min(1).default("neutral"),
  updated_at: z.string().datetime({ offset: true }).or(z.string()),
});

export type BotMood = z.infer<typeof botMoodSchema>;

export interface UpsertPlayerInput {
  user_id: string;
  username: string;
  preferred_name?: string | null;
  affinity?: number;
  summary?: string | null;
  last_seen_at?: string;
}

export interface FactInput {
  fact: string;
  category?: FactCategory;
}

export interface UpsertBotMoodInput {
  guild_id: string;
  energy?: number;
  warmth?: number;
  sarcasm?: number;
  current_vibe?: string;
  updated_at?: string;
}

export const bufferedMessageSchema = z.object({
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  isBot: z.boolean(),
  content: z.string(),
  timestamp: z.number().int().nonnegative(),
  replyToAuthorName: z.string().nullable().optional(),
});

export type BufferedMessage = z.infer<typeof bufferedMessageSchema>;

export interface AddBufferedMessageInput {
  authorId: string;
  authorName: string;
  isBot?: boolean;
  content: string;
  timestamp?: number | Date;
  replyToAuthorName?: string | null;
}

export interface FormatBufferOptions {
  limit?: number;
  includeBotTag?: boolean;
  includeReplies?: boolean;
}

export interface ConversationHistoryOptions {
  limit?: number;
  excludeLast?: boolean;
  activeUserId?: string;
}

export interface ChannelBufferOptions {
  maxMessages?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
  autoStartCleanup?: boolean;
}
