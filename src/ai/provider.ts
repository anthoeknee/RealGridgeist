import { GoogleGenAI, type Content, type GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "../env";

/**
 * Default configurations for the AI provider
 */
export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * In-character fallback responses for Gridgeist when network, safety, or timeout events occur.
 */
export const FALLBACK_MESSAGES = {
  TIMEOUT:
    "*The data stream flickers and fades into static... The Grid took too long to respond. Try pinging me again in a moment.*",
  SAFETY_BLOCKED:
    "*Static surges across the terminal. That query hit an impenetrable firewall in my neural grid—I cannot parse that signal.*",
  GENERIC_ERROR:
    "*A brief power surge echoes through the circuitry. My connection to the datastream glitched—let's try that again.*",
} as const;

let defaultClient: GoogleGenAI | null = null;

/**
 * Retrieves the singleton GoogleGenAI client or instantiates a new one with the given API key.
 */
export function getAiClient(apiKey: string = env.GEMINI_API_KEY): GoogleGenAI {
  if (!defaultClient || apiKey !== env.GEMINI_API_KEY) {
    const client = new GoogleGenAI({ apiKey });
    if (apiKey === env.GEMINI_API_KEY) {
      defaultClient = client;
    }
    return client;
  }
  return defaultClient;
}

/**
 * Allows overriding the default GoogleGenAI client (useful for unit testing and mocking).
 */
export function setAiClient(client: GoogleGenAI | null): void {
  defaultClient = client;
}

/**
 * Represents a simplified turn in conversation history.
 */
export interface ChatHistoryMessage {
  role: "user" | "model" | "assistant";
  content: string;
}

/**
 * Represents any supported turn format for conversation history,
 * including native GenAI Content objects, buffered channel messages, or simplified messages.
 */
export type ConversationTurn =
  | ChatHistoryMessage
  | Content
  | {
      isBot?: boolean;
      authorName?: string;
      content: string;
    };

/**
 * Options for generating a natural language chat reply.
 */
export interface GenerateChatReplyOptions {
  /**
   * System instruction defining Gridgeist's persona, lore, tone, and guardrails.
   */
  systemPrompt?: string;

  /**
   * Prior conversation turns to provide multi-turn context.
   */
  conversationHistory?: ConversationTurn[];

  /**
   * The latest user message prompting the reply.
   */
  userMessage: string;

  /**
   * Sampling temperature (e.g. 0.0 to 1.0). Defaults to 0.7.
   */
  temperature?: number;

  /**
   * Generation timeout in milliseconds. Defaults to 15,000ms.
   */
  timeoutMs?: number;

  /**
   * Alias for timeoutMs for developer convenience.
   */
  timeout?: number;

  /**
   * The Gemini model identifier. Defaults to 'gemini-2.5-flash'.
   */
  model?: string;

  /**
   * Optional custom GoogleGenAI client instance.
   */
  client?: GoogleGenAI;

  /**
   * Optional custom in-character fallback message to return on failure.
   */
  fallbackMessage?: string;
}

/**
 * Options for generating structured JSON output constrained and validated by a Zod schema.
 */
export interface GenerateStructuredOutputOptions<T> {
  /**
   * The user prompt or instructions specifying what data to extract or generate.
   */
  prompt: string;

  /**
   * The Zod schema to enforce on the model's output.
   */
  schema: z.ZodType<T>;

  /**
   * Optional system instructions defining extraction rules or context.
   */
  systemPrompt?: string;

  /**
   * Sampling temperature. Defaults to 0.1 for high determinism and schema adherence.
   */
  temperature?: number;

  /**
   * Generation timeout in milliseconds. Defaults to 15,000ms.
   */
  timeoutMs?: number;

  /**
   * Alias for timeoutMs.
   */
  timeout?: number;

  /**
   * The Gemini model identifier. Defaults to 'gemini-2.5-flash'.
   */
  model?: string;

  /**
   * Optional custom GoogleGenAI client instance.
   */
  client?: GoogleGenAI;

  /**
   * Optional fallback value returned if generation, parsing, or validation fails.
   */
  fallback?: T;
}

/**
 * Strips markdown code block formatting (e.g. ```json ... ```) from a string if present.
 */
export function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Converts a Zod schema into a Gemini-compatible JSON schema definition,
 * stripping extraneous metadata like top-level $schema that Gemini rejects.
 */
export function zodToGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;

  // Clean out top-level $schema property which Gemini API rejects
  const { $schema, ...cleaned } = raw;
  return cleaned;
}

/**
 * Formats, normalizes, and coalesces conversation history and the latest user message
 * into a valid sequence of alternating Gemini Content turns.
 */
export function buildChatContents(
  userMessage: string,
  history?: ConversationTurn[]
): Content[] {
  const contents: Content[] = [];

  if (history && history.length > 0) {
    for (const turn of history) {
      if (!turn) continue;

      if ("parts" in turn && Array.isArray(turn.parts)) {
        contents.push({
          role: (turn.role === "assistant" ? "model" : (turn.role ?? "user")) as "user" | "model",
          parts: [...turn.parts],
        });
      } else if ("content" in turn) {
        if ("role" in turn && turn.role) {
          const role = (turn.role === "assistant" ? "model" : turn.role) as "user" | "model";
          contents.push({
            role,
            parts: [{ text: turn.content }],
          });
        } else {
          const authorName = "authorName" in turn ? turn.authorName : undefined;
          const isBot = "isBot" in turn ? Boolean(turn.isBot) : false;
          const text = authorName && !isBot ? `${authorName}: ${turn.content}` : turn.content;
          contents.push({
            role: isBot ? "model" : "user",
            parts: [{ text }],
          });
        }
      }
    }
  }

  // Append user's current message
  contents.push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  // Coalesce consecutive turns of identical role to satisfy Gemini multi-turn requirements
  const coalesced: Content[] = [];
  for (const item of contents) {
    if (!item.parts || item.parts.length === 0) continue;
    const last = coalesced[coalesced.length - 1];
    if (last && last.role === item.role) {
      if (!last.parts) {
        last.parts = [];
      }
      last.parts.push(...item.parts);
    } else {
      coalesced.push({
        role: item.role,
        parts: [...item.parts],
      });
    }
  }

  // Ensure first turn starts with a user role
  if (coalesced.length > 0 && coalesced[0]?.role === "model") {
    coalesced.unshift({
      role: "user",
      parts: [{ text: "[Prior conversation context]" }],
    });
  }

  return coalesced;
}

/**
 * Checks if an error represents an abort or timeout condition.
 */
export function isTimeoutOrAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    const msg = err.message.toLowerCase();
    if (
      msg.includes("abort") ||
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("deadline exceeded")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an error message indicates a safety or content moderation block.
 */
export function isSafetyErrorMessage(msg: string): boolean {
  const upper = msg.toUpperCase();
  return (
    upper.includes("SAFETY") ||
    upper.includes("BLOCKED") ||
    upper.includes("PROHIBITED") ||
    upper.includes("CONTENT_FILTER") ||
    upper.includes("FILTERED")
  );
}

/**
 * Generates an in-character chat reply using Gemini, supporting configurable temperature,
 * timeouts, system instructions, and conversation history.
 *
 * Catches all internal errors, timeouts, and safety blocks gracefully, returning an in-character
 * message rather than throwing an unhandled exception.
 */
export async function generateChatReply(
  options: GenerateChatReplyOptions
): Promise<string> {
  const effectiveTimeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const effectiveTemperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const effectiveModel = options.model ?? DEFAULT_MODEL;
  const client = options.client ?? getAiClient();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const contents = buildChatContents(options.userMessage, options.conversationHistory);

    const config: GenerateContentConfig = {
      temperature: effectiveTemperature,
      httpOptions: { timeout: effectiveTimeoutMs },
      abortSignal: controller.signal,
    };

    if (options.systemPrompt && options.systemPrompt.trim().length > 0) {
      config.systemInstruction = options.systemPrompt.trim();
    }

    const generatePromise = client.models.generateContent({
      model: effectiveModel,
      contents,
      config,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(`Request timed out after ${effectiveTimeoutMs}ms`);
        err.name = "TimeoutError";
        reject(err);
      }, effectiveTimeoutMs);
      if (timer && typeof (timer as any).unref === "function") {
        (timer as any).unref();
      }
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);

    // Inspect candidate and prompt feedback for safety blocks
    const candidate = response.candidates?.[0];
    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = candidate?.finishReason;

    const isBlocked =
      blockReason === "SAFETY" ||
      blockReason === "BLOCKLIST" ||
      blockReason === "PROHIBITED_CONTENT" ||
      finishReason === "SAFETY" ||
      finishReason === "BLOCKLIST" ||
      finishReason === "PROHIBITED_CONTENT";

    if (isBlocked) {
      console.warn(
        `[AI Provider] Chat generation blocked by safety filters (blockReason: ${blockReason}, finishReason: ${finishReason})`
      );
      return options.fallbackMessage ?? FALLBACK_MESSAGES.SAFETY_BLOCKED;
    }

    const replyText = response.text?.trim();
    if (!replyText) {
      console.warn(
        `[AI Provider] Chat generation returned empty text (finishReason: ${finishReason ?? "unknown"})`
      );
      return options.fallbackMessage ?? FALLBACK_MESSAGES.GENERIC_ERROR;
    }

    return replyText;
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      console.warn(`[AI Provider] Chat generation timed out after ${effectiveTimeoutMs}ms`);
      return options.fallbackMessage ?? FALLBACK_MESSAGES.TIMEOUT;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (isSafetyErrorMessage(message)) {
      console.warn(`[AI Provider] Chat generation blocked with error: ${message}`);
      return options.fallbackMessage ?? FALLBACK_MESSAGES.SAFETY_BLOCKED;
    }

    console.error("[AI Provider] Unexpected error during generateChatReply:", error);
    return options.fallbackMessage ?? FALLBACK_MESSAGES.GENERIC_ERROR;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Generates structured JSON output from Gemini, enforced by responseJsonSchema at the model level
 * and strictly validated at runtime using Zod.
 *
 * If generation, network, timeout, or Zod validation fails, gracefully returns the provided fallback
 * or null without throwing an unhandled exception.
 */
export async function generateStructuredOutput<T>(
  options: GenerateStructuredOutputOptions<T> & { fallback: T }
): Promise<T>;
export async function generateStructuredOutput<T>(
  options: GenerateStructuredOutputOptions<T>
): Promise<T | null>;
export async function generateStructuredOutput<T>(
  options: GenerateStructuredOutputOptions<T>
): Promise<T | null> {
  const effectiveTimeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const effectiveTemperature = options.temperature ?? 0.1;
  const effectiveModel = options.model ?? DEFAULT_MODEL;
  const client = options.client ?? getAiClient();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const jsonSchema = zodToGeminiSchema(options.schema);

    const config: GenerateContentConfig = {
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      temperature: effectiveTemperature,
      httpOptions: { timeout: effectiveTimeoutMs },
      abortSignal: controller.signal,
    };

    if (options.systemPrompt && options.systemPrompt.trim().length > 0) {
      config.systemInstruction = options.systemPrompt.trim();
    }

    const generatePromise = client.models.generateContent({
      model: effectiveModel,
      contents: options.prompt,
      config,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(`Request timed out after ${effectiveTimeoutMs}ms`);
        err.name = "TimeoutError";
        reject(err);
      }, effectiveTimeoutMs);
      if (timer && typeof (timer as any).unref === "function") {
        (timer as any).unref();
      }
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);

    // Inspect candidate and prompt feedback for safety blocks
    const candidate = response.candidates?.[0];
    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = candidate?.finishReason;

    const isBlocked =
      blockReason === "SAFETY" ||
      blockReason === "BLOCKLIST" ||
      blockReason === "PROHIBITED_CONTENT" ||
      finishReason === "SAFETY" ||
      finishReason === "BLOCKLIST" ||
      finishReason === "PROHIBITED_CONTENT";

    if (isBlocked) {
      console.warn(
        `[AI Provider] Structured generation blocked by safety filters (blockReason: ${blockReason}, finishReason: ${finishReason})`
      );
      return options.fallback ?? null;
    }

    const rawText = response.text?.trim();
    if (!rawText) {
      console.warn(
        `[AI Provider] Structured generation returned empty text (finishReason: ${finishReason ?? "unknown"})`
      );
      return options.fallback ?? null;
    }

    const cleanedText = cleanJsonString(rawText);
    const parsedJson = JSON.parse(cleanedText);
    const validated = options.schema.parse(parsedJson);

    return validated;
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      console.warn(`[AI Provider] Structured generation timed out after ${effectiveTimeoutMs}ms`);
    } else if (error instanceof z.ZodError) {
      console.warn("[AI Provider] Structured output failed Zod validation:", error.format());
    } else if (error instanceof SyntaxError) {
      console.warn("[AI Provider] Structured output failed JSON parsing:", error.message);
    } else {
      console.error("[AI Provider] Unexpected error during generateStructuredOutput:", error);
    }

    return options.fallback ?? null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
