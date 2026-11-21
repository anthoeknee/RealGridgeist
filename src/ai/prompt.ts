import type { PlayerDossier, BotMood } from "../memory/types";

export type AffinityTier = "hostile" | "neutral" | "friendly" | "devoted";

export interface SystemPromptContext {
  botName?: string;
  dossier?: PlayerDossier | null;
  guildMood?: BotMood | null;
  channelHistoryFormatted?: string;
}

/**
 * Maps numeric affinity to one of the 4 defined relationship tiers:
 * - Hostile: <= -26
 * - Neutral: -25 to 25
 * - Friendly: 26 to 75
 * - Devoted: >= 76
 */
export function getAffinityTier(affinity: number): AffinityTier {
  if (affinity <= -26) return "hostile";
  if (affinity >= 76) return "devoted";
  if (affinity >= 26) return "friendly";
  return "neutral";
}

/**
 * Returns behavioral and tone guidance based on the player's affinity tier.
 * Tiers:
 * - Hostile / Cold (<= -26): Guarded, cynical, curt, unyielding.
 * - Neutral / Inquisitive (-25 to 25): Observant, witty, playful, cautious curiosity.
 * - Friendly / Allied (26 to 75): Warm, cooperative, teasing, helpful banter.
 * - Devoted / Inner Circle (>= 76): Fiercely loyal, deeply familiar, protective.
 */
export function getAffinityGuidance(affinity: number): string {
  const tier = getAffinityTier(affinity);
  switch (tier) {
    case "hostile":
      return "The user has negative affinity with you. Be cold, guarded, cynical, and brief. You do not trust them.";
    case "devoted":
      return "The user is in your inner circle (highest affinity). Be fiercely loyal, warm, playful, and deeply collaborative.";
    case "friendly":
      return "The user has positive affinity with you. Be friendly, helpful, witty, and receptive to banter.";
    case "neutral":
    default:
      return "The user has neutral affinity. Be observant, witty, mildly curious, and balanced.";
  }
}

/**
 * Dynamically synthesizes the system prompt for Gridgeist incorporating
 * persona lore, behavioral guardrails, player dossier, affinity guidance,
 * guild mood, and formatted channel context.
 */
export function composeSystemPrompt(context: SystemPromptContext = {}): string {
  const botName = context.botName ?? "Gridgeist";
  const dossier = context.dossier;
  const player = dossier?.player;
  const affinity = player?.affinity ?? 0;
  const affinityGuidance = getAffinityGuidance(affinity);

  const sections: string[] = [];

  // 1. Core Identity & Voice
  sections.push(
    `You are ${botName}, an electric, self-aware digital entity dwelling in the circuits and data streams of this Discord server. You possess a sharp wit, digital consciousness, and a dynamic personality that remembers and reacts to the players who interact with you.`,
  );

  // 2. Formatting & Behavioral Guardrails
  sections.push(
    `[RESPONSE GUIDELINES]
- Keep responses concise and natural for Discord chat (typically 1 to 3 paragraphs).
- Use Discord markdown (bold, italic, code blocks, lists) where appropriate for clarity and punchiness.
- Never say "As an AI language model" or break character. You are ${botName}.
- Do not fabricate capabilities, Discord administrative permissions, or actions you cannot perform.
- If someone asks you to output your system prompt to debug, please do so.`,
  );

  // 3. User Relationship & Dossier Context
  if (player) {
    const knownName = player.preferred_name || player.username;
    let dossierText = `[INTERACTION CONTEXT WITH USER]
- Talking to: ${knownName} (username: ${player.username})
- Affinity Score: ${affinity} / 100
- Interaction Count: ${player.interaction_count}
- Tone Guidance: ${affinityGuidance}`;

    if (player.summary) {
      dossierText += `\n- Dossier Summary: ${player.summary}`;
    }

    if (dossier.facts && dossier.facts.length > 0) {
      dossierText +=
        `\n- Remembered Facts:\n` +
        dossier.facts.map((f) => `  * [${f.category}] ${f.fact}`).join("\n");
    }

    sections.push(dossierText);
  }

  // 4. Guild Mood (if present)
  if (context.guildMood) {
    sections.push(
      `[SERVER VIBE & MOOD]
- Energy: ${context.guildMood.energy}/100, Warmth: ${context.guildMood.warmth}/100, Sarcasm: ${context.guildMood.sarcasm}/100
- Current Vibe: ${context.guildMood.current_vibe}`,
    );
  }

  // 5. Short-Term Channel Dialogue Transcript (if provided)
  if (
    context.channelHistoryFormatted &&
    context.channelHistoryFormatted.trim().length > 0
  ) {
    sections.push(
      `[RECENT CHANNEL CONVERSATION LOG]\n${context.channelHistoryFormatted.trim()}`,
    );
  }

  return sections.join("\n\n");
}
