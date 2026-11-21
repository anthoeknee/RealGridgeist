import { z } from "zod";
import { generateStructuredOutput, type AiProviderName } from "./provider";
import type { PlayerDossier, PlayerFact, Player, FactInput, FactCategory } from "../memory/types";
import { playerRepo, PlayerRepository } from "../memory/playerRepo";

/**
 * Zod schema for a single extracted fact item.
 * Supports categorization into: preference, game_stat, lore, inside_joke, or other.
 */
export const extractedFactSchema = z.object({
  fact: z
    .string()
    .min(1)
    .describe("A distinct, memorable, and durable fact, preference, or detail learned about the user"),
  category: z
    .enum(["preference", "game_stat", "lore", "inside_joke", "other"])
    .default("other")
    .describe("Category of the fact: preference, game_stat, lore, inside_joke, or other"),
});

/**
 * Zod schema for structured memory and affinity extraction from conversations.
 */
export const extractedMemorySchema = z.object({
  facts: z
    .array(
      z.preprocess((val) => {
        if (typeof val === "string") {
          return { fact: val, category: "other" };
        }
        return val;
      }, extractedFactSchema)
    )
    .default([])
    .describe("Array of new durable facts learned about the user from the interaction"),
  affinityDelta: z.preprocess(
    (val) => {
      if (val === null || val === undefined) return 0;
      if (typeof val === "number") {
        return Math.max(-5, Math.min(5, Math.round(val)));
      }
      return val;
    },
    z
      .number()
      .int()
      .min(-5)
      .max(5)
      .default(0)
      .describe(
        "Affinity delta (-5 to +5) representing how the interaction shifted the relationship (-5 to -1 for hostility/rudeness, 0 for neutral, +1 to +5 for friendliness/helpfulness)"
      )
  ),
  summaryUpdate: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return null;
      if (typeof val === "string") {
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      return null;
    },
    z
      .string()
      .nullable()
      .optional()
      .describe(
        "Updated 1-2 sentence overview of the player's personality, background, or identity, or null if no update is needed"
      )
  ),
});

export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;

/**
 * Options for extracting memories from a chat interaction.
 */
export interface ExtractMemoriesOptions {
  userId: string;
  userName?: string;
  userMessage: string;
  botReply?: string;
  channelHistory?: string;
  dossier?: PlayerDossier | null;
  playerRepository?: PlayerRepository;
  client?: unknown;
  provider?: AiProviderName;
  model?: string;
  timeoutMs?: number;
}

/**
 * Result returned upon successful extraction and persistence.
 */
export interface ExtractMemoriesResult {
  extracted: ExtractedMemory;
  savedFacts: PlayerFact[];
  updatedPlayer: Player | null;
}

/**
 * Composes the structured extraction prompt and system instructions for the LLM.
 */
export function composeExtractionPrompt(opts: ExtractMemoriesOptions): {
  prompt: string;
  systemPrompt: string;
} {
  const systemPrompt = `You are the memory and cognition engine for Gridgeist, a digital entity dwelling in a Discord server.
Your task is to analyze recent conversations between a user and Gridgeist, extracting meaningful personal details, relationship sentiment, and player profile updates.

Guidelines:
1. Facts:
   - Extract durable, persistent facts, user preferences, game achievements/stats, lore, inside jokes, or real-life details explicitly shared by the player.
   - Categorize each fact as "preference", "game_stat", "lore", "inside_joke", or "other".
   - DO NOT extract ephemeral conversational noise, greetings, routine questions, or transient context (e.g. do NOT extract "said hello", "asked about time", "agreed with bot", or "is typing").
   - If no new persistent facts were learned, return an empty array for facts.
2. Affinity Delta (-5 to +5):
   - +1 to +5: Player was respectful, friendly, appreciative, complimentary, shared fun banter, or helped the bot.
   - 0: Neutral, factual, informational, or standard command/query interaction.
   - -1 to -5: Player was hostile, insulting, dismissive, trolling, or abusive.
3. Summary Update:
   - If this interaction reveals meaningful new dimensions of who the player is, provide an updated, concise 1-2 sentence overall profile summary.
   - If the player's existing summary is already accurate and sufficient, or if no significant new identity details were learned, return null.`;

  const sections: string[] = [];

  // 1. User Profile Context
  const profileLines: string[] = [`User ID: ${opts.userId}`];
  if (opts.userName) {
    profileLines.push(`Username: ${opts.userName}`);
  }
  if (opts.dossier?.player) {
    profileLines.push(`Current Affinity: ${opts.dossier.player.affinity}/100`);
    if (opts.dossier.player.summary) {
      profileLines.push(`Existing Summary: ${opts.dossier.player.summary}`);
    }
  }
  if (opts.dossier?.facts && opts.dossier.facts.length > 0) {
    const factsList = opts.dossier.facts
      .map((f) => `  * [${f.category}] ${f.fact}`)
      .join("\n");
    profileLines.push(`Existing Known Facts:\n${factsList}`);
  }
  sections.push(`[PLAYER PROFILE]\n${profileLines.join("\n")}`);

  // 2. Channel Transcript Context (if available)
  if (opts.channelHistory && opts.channelHistory.trim().length > 0) {
    sections.push(`[RECENT CHANNEL CONVERSATION LOG]\n${opts.channelHistory.trim()}`);
  }

  // 3. Current Interaction
  const interactionLines: string[] = [];
  if (opts.userMessage && opts.userMessage.trim().length > 0) {
    interactionLines.push(`User Message: ${opts.userMessage.trim()}`);
  }
  if (opts.botReply && opts.botReply.trim().length > 0) {
    interactionLines.push(`Gridgeist Reply: ${opts.botReply.trim()}`);
  }
  sections.push(`[INTERACTION TO ANALYZE]\n${interactionLines.join("\n")}`);

  sections.push(
    "Analyze the interaction carefully according to your instructions. Output JSON matching the schema with facts, affinityDelta, and summaryUpdate."
  );

  return {
    prompt: sections.join("\n\n"),
    systemPrompt,
  };
}

/**
 * Extracts facts, affinity delta, and profile summary from an interaction and persists them to the database.
 * This operation is fully non-blocking and safe for background execution (never throws).
 */
export async function extractMemories(
  options: ExtractMemoriesOptions
): Promise<ExtractMemoriesResult | null>;
export async function extractMemories(
  userId: string,
  userMessage: string,
  botReply?: string,
  dossier?: PlayerDossier | null
): Promise<ExtractMemoriesResult | null>;
export async function extractMemories(
  optionsOrUserId: ExtractMemoriesOptions | string,
  userMessage?: string,
  botReply?: string,
  dossier?: PlayerDossier | null
): Promise<ExtractMemoriesResult | null> {
  let userId = "";

  try {
    const opts: ExtractMemoriesOptions =
      typeof optionsOrUserId === "string"
        ? {
            userId: optionsOrUserId,
            userMessage: userMessage ?? "",
            botReply,
            dossier,
          }
        : optionsOrUserId;

    userId = opts.userId?.trim();
    if (!userId) {
      return null;
    }

    const trimmedUserMsg = opts.userMessage?.trim() ?? "";
    const trimmedBotReply = opts.botReply?.trim() ?? "";

    // If both message and reply are empty, nothing meaningful to extract
    if (!trimmedUserMsg && !trimmedBotReply) {
      return null;
    }

    const repo = opts.playerRepository ?? playerRepo;

    // Load dossier if not provided
    const resolvedDossier =
      opts.dossier !== undefined ? opts.dossier : repo.getPlayerDossier(userId);

    const userName = opts.userName ?? resolvedDossier?.player?.username ?? userId;

    const { prompt, systemPrompt } = composeExtractionPrompt({
      ...opts,
      userId,
      userName,
      dossier: resolvedDossier,
    });

    const extracted = await generateStructuredOutput<ExtractedMemory>({
      prompt,
      systemPrompt,
      schema: extractedMemorySchema as unknown as z.ZodType<ExtractedMemory>,
      client: opts.client as any,
      provider: opts.provider,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
    });

    if (!extracted) {
      return null;
    }

    // Ensure player profile exists in repository before updating affinity or summary
    if (!repo.getPlayer(userId)) {
      repo.upsertPlayer({
        user_id: userId,
        username: userName,
        preferred_name: resolvedDossier?.player?.preferred_name ?? null,
      });
    }

    // Filter and sanitize facts
    const validFacts: FactInput[] = (extracted.facts ?? [])
      .filter((f) => f && typeof f.fact === "string" && f.fact.trim().length > 0)
      .map((f) => ({
        fact: f.fact.trim(),
        category: (f.category as FactCategory) ?? "other",
      }));

    let savedFacts: PlayerFact[] = [];
    let updatedPlayer: Player | null = null;

    const hasFacts = validFacts.length > 0;
    const hasDelta = extracted.affinityDelta !== undefined && extracted.affinityDelta !== 0;

    // Atomically persist facts and affinity delta
    if (hasFacts || hasDelta) {
      const result = repo.addFactsAndAdjustAffinity(userId, validFacts, extracted.affinityDelta);
      savedFacts = result.facts;
      updatedPlayer = result.player;
    } else {
      updatedPlayer = repo.getPlayer(userId);
    }

    // Update player dossier summary if provided
    if (
      extracted.summaryUpdate &&
      typeof extracted.summaryUpdate === "string" &&
      extracted.summaryUpdate.trim().length > 0
    ) {
      const summaryResult = repo.updateSummary(userId, extracted.summaryUpdate.trim());
      if (summaryResult) {
        updatedPlayer = summaryResult;
      }
    }

    return {
      extracted,
      savedFacts,
      updatedPlayer,
    };
  } catch (error) {
    console.error(`[Memory Extractor] Background extraction failed for user '${userId}':`, error);
    return null;
  }
}
