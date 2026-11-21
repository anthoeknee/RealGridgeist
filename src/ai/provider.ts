import { GoogleGenAI, type Content, type GenerateContentConfig } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "../env";

/**
 * Supported AI API providers.
 * Primary: "gemini" (@google/genai)
 * Secondary: "groq" (groq-sdk)
 */
export type AiProvider = "gemini" | "groq";
export type AiProviderName = AiProvider | "genai";

/**
 * Default configurations for the AI providers
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
export const DEFAULT_MODEL = DEFAULT_GEMINI_MODEL;
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

let defaultGeminiClient: GoogleGenAI | null = null;
let cachedGeminiApiKey: string | undefined = undefined;
let defaultGroqClient: Groq | null = null;
let cachedGroqApiKey: string | undefined = undefined;
let currentDefaultProvider: AiProvider =
  (env.DEFAULT_AI_PROVIDER as AiProvider) ?? "gemini";

/**
 * Normalizes provider name aliases (e.g. 'genai' -> 'gemini').
 */
export function normalizeProvider(provider: AiProviderName): AiProvider {
  if (provider === "genai" || provider === "gemini") {
    return "gemini";
  }
  if (provider === "groq") {
    return "groq";
  }
  throw new Error(`Unsupported AI provider: ${provider}`);
}

/**
 * Gets the current default AI provider ('gemini' or 'groq').
 */
export function getDefaultAiProvider(): AiProvider {
  return currentDefaultProvider;
}

/**
 * Sets the default AI provider ('gemini' or 'groq') for subsequent calls.
 */
export function setDefaultAiProvider(provider: AiProviderName): void {
  currentDefaultProvider = normalizeProvider(provider);
}

/**
 * Retrieves the singleton GoogleGenAI client or instantiates a new one with the given API key.
 */
export function getGeminiClient(apiKey: string = env.GEMINI_API_KEY): GoogleGenAI {
  if (defaultGeminiClient && (!apiKey || apiKey === cachedGeminiApiKey || apiKey === env.GEMINI_API_KEY)) {
    return defaultGeminiClient;
  }
  const client = new GoogleGenAI({ apiKey });
  defaultGeminiClient = client;
  cachedGeminiApiKey = apiKey;
  return client;
}

/**
 * Allows overriding the default GoogleGenAI client (useful for unit testing and mocking).
 */
export function setGeminiClient(client: GoogleGenAI | null): void {
  defaultGeminiClient = client;
  cachedGeminiApiKey = undefined;
}

/**
 * Backwards-compatible aliases for Gemini client access.
 */
export const getAiClient = getGeminiClient;
export const setAiClient = setGeminiClient;

/**
 * Retrieves the singleton Groq client or instantiates a new one with the given API key.
 */
export function getGroqClient(apiKey?: string): Groq {
  if (defaultGroqClient && (!apiKey || apiKey === cachedGroqApiKey)) {
    return defaultGroqClient;
  }
  const key = apiKey ?? env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not configured in environment variables or passed to getGroqClient."
    );
  }
  const client = new Groq({ apiKey: key });
  defaultGroqClient = client;
  cachedGroqApiKey = apiKey ?? key;
  return client;
}

/**
 * Allows overriding the default Groq client (useful for unit testing and mocking).
 */
export function setGroqClient(client: Groq | null): void {
  defaultGroqClient = client;
  cachedGroqApiKey = undefined;
}

/**
 * Resets all singleton clients and resets default provider to environment setting.
 */
export function resetAiClients(): void {
  defaultGeminiClient = null;
  cachedGeminiApiKey = undefined;
  defaultGroqClient = null;
  cachedGroqApiKey = undefined;
  currentDefaultProvider = (env.DEFAULT_AI_PROVIDER as AiProvider) ?? "gemini";
}

/**
 * Resolves the provider to use given explicit options and client instances.
 */
export function resolveProvider(options: {
  provider?: AiProviderName;
  client?: GoogleGenAI | Groq | unknown;
}): AiProvider {
  if (options.provider) {
    return normalizeProvider(options.provider);
  }
  if (options.client) {
    const client = options.client as any;
    if (client.chat && typeof client.chat.completions?.create === "function") {
      return "groq";
    }
    if (client.models && typeof client.models.generateContent === "function") {
      return "gemini";
    }
  }
  return getDefaultAiProvider();
}

/**
 * Represents a simplified turn in conversation history.
 */
export interface ChatHistoryMessage {
  role: "user" | "model" | "assistant";
  content: string;
}

/**
 * Represents a normalized message for Groq (OpenAI-compatible).
 */
export interface GroqMessage {
  role: "system" | "user" | "assistant";
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
   * The AI provider to use ('gemini' | 'groq' | 'genai'). Defaults to current default provider.
   */
  provider?: AiProviderName;

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
   * Model identifier. Defaults to provider default (Gemini: gemini-2.5-flash, Groq: llama-3.3-70b-versatile).
   */
  model?: string;

  /**
   * Optional custom client instance (GoogleGenAI or Groq).
   */
  client?: GoogleGenAI | Groq;

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
   * The AI provider to use ('gemini' | 'groq' | 'genai'). Defaults to current default provider.
   */
  provider?: AiProviderName;

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
   * Model identifier. Defaults to provider default.
   */
  model?: string;

  /**
   * Optional custom client instance (GoogleGenAI or Groq).
   */
  client?: GoogleGenAI | Groq;

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
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = cleaned.match(fenceRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  } else {
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();
  }
  return cleaned;
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
 * Converts a Zod schema into a Groq-compatible JSON schema definition.
 */
export function zodToGroqSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;

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
 * Formats and normalizes conversation history and latest user message
 * into Groq (OpenAI-compatible) message objects.
 */
export function buildGroqMessages(
  userMessage: string,
  history?: ConversationTurn[],
  systemPrompt?: string
): GroqMessage[] {
  const messages: GroqMessage[] = [];

  if (systemPrompt && systemPrompt.trim().length > 0) {
    messages.push({
      role: "system",
      content: systemPrompt.trim(),
    });
  }

  if (history && history.length > 0) {
    for (const turn of history) {
      if (!turn) continue;

      if ("parts" in turn && Array.isArray(turn.parts)) {
        const text = turn.parts
          .map((p) => {
            if ("text" in p && typeof p.text === "string") return p.text;
            return "";
          })
          .filter(Boolean)
          .join("\n");

        if (text) {
          const role = turn.role === "model" ? "assistant" : "user";
          messages.push({ role, content: text });
        }
      } else if ("content" in turn) {
        if ("role" in turn && turn.role) {
          const role =
            turn.role === "model" || turn.role === "assistant" ? "assistant" : "user";
          messages.push({ role, content: turn.content });
        } else {
          const authorName = "authorName" in turn ? turn.authorName : undefined;
          const isBot = "isBot" in turn ? Boolean(turn.isBot) : false;
          const text = authorName && !isBot ? `${authorName}: ${turn.content}` : turn.content;
          messages.push({
            role: isBot ? "assistant" : "user",
            content: text,
          });
        }
      }
    }
  }

  messages.push({
    role: "user",
    content: userMessage,
  });

  return messages;
}

/**
 * Checks if an error represents an abort or timeout condition.
 */
export function isTimeoutOrAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    const status = (err as any).status;
    if (status === 504 || status === 408) return true;
    const msg = err.message.toLowerCase();
    if (
      msg.includes("abort") ||
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("deadline exceeded") ||
      msg.includes("deadline_exceeded") ||
      msg.includes("deadline expired")
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
    upper.includes("FILTERED") ||
    upper.includes("CONTENT POLICY") ||
    upper.includes("VIOLATES")
  );
}

/**
 * Generates chat reply using Google GenAI (Gemini).
 */
export async function generateGeminiChatReply(
  options: GenerateChatReplyOptions
): Promise<string> {
  const effectiveTimeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const effectiveTemperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const effectiveModel = options.model ?? DEFAULT_GEMINI_MODEL;
  const client = (options.client as GoogleGenAI) ?? getGeminiClient();

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
        `[AI Provider: Gemini] Chat generation blocked by safety filters (blockReason: ${blockReason}, finishReason: ${finishReason})`
      );
      return options.fallbackMessage ?? FALLBACK_MESSAGES.SAFETY_BLOCKED;
    }

    const replyText = response.text?.trim();
    if (!replyText) {
      console.warn(
        `[AI Provider: Gemini] Chat generation returned empty text (finishReason: ${finishReason ?? "unknown"})`
      );
      return options.fallbackMessage ?? FALLBACK_MESSAGES.GENERIC_ERROR;
    }

    return replyText;
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      console.warn(`[AI Provider: Gemini] Chat generation timed out after ${effectiveTimeoutMs}ms`);
      return options.fallbackMessage ?? FALLBACK_MESSAGES.TIMEOUT;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (isSafetyErrorMessage(message)) {
      console.warn(`[AI Provider: Gemini] Chat generation blocked with error: ${message}`);
      return options.fallbackMessage ?? FALLBACK_MESSAGES.SAFETY_BLOCKED;
    }

    console.error("[AI Provider: Gemini] Unexpected error during generateChatReply:", error);
    return options.fallbackMessage ?? FALLBACK_MESSAGES.GENERIC_ERROR;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Generates chat reply using Groq (groq-sdk).
 */
export async function generateGroqChatReply(
  options: GenerateChatReplyOptions
): Promise<string> {
  const effectiveTimeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const effectiveTemperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const effectiveModel = options.model ?? DEFAULT_GROQ_MODEL;
  const client = (options.client as Groq) ?? getGroqClient();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const messages = buildGroqMessages(
      options.userMessage,
      options.conversationHistory,
      options.systemPrompt
    );

    const generatePromise = client.chat.completions.create(
      {
        model: effectiveModel,
        messages: messages as any,
        temperature: effectiveTemperature,
      },
      {
        signal: controller.signal,
        timeout: effectiveTimeoutMs,
      }
    );

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

    const choice = response.choices?.[0];
    const finishReason = choice?.finish_reason;

    if ((finishReason as string) === "content_filter") {
      console.warn(
        `[AI Provider: Groq] Chat generation blocked by safety filters (finish_reason: ${finishReason})`
      );
      return options.fallbackMessage ?? FALLBACK_MESSAGES.SAFETY_BLOCKED;
    }

    const replyText = choice?.message?.content?.trim();
    if (!replyText) {
      console.warn(
        `[AI Provider: Groq] Chat generation returned empty text (finishReason: ${finishReason ?? "unknown"})`
      );
      return options.fallbackMessage ?? FALLBACK_MESSAGES.GENERIC_ERROR;
    }

    return replyText;
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      console.warn(`[AI Provider: Groq] Chat generation timed out after ${effectiveTimeoutMs}ms`);
      return options.fallbackMessage ?? FALLBACK_MESSAGES.TIMEOUT;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (isSafetyErrorMessage(message)) {
      console.warn(`[AI Provider: Groq] Chat generation blocked with error: ${message}`);
      return options.fallbackMessage ?? FALLBACK_MESSAGES.SAFETY_BLOCKED;
    }

    console.error("[AI Provider: Groq] Unexpected error during generateChatReply:", error);
    return options.fallbackMessage ?? FALLBACK_MESSAGES.GENERIC_ERROR;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Generates an in-character chat reply using the selected provider (Gemini or Groq).
 * Supports configurable temperature, timeouts, system instructions, and conversation history.
 *
 * Catches all internal errors, timeouts, and safety blocks gracefully, returning an in-character
 * message rather than throwing an unhandled exception.
 */
export async function generateChatReply(
  options: GenerateChatReplyOptions
): Promise<string> {
  const provider = resolveProvider(options);
  if (provider === "groq") {
    return generateGroqChatReply(options);
  }
  return generateGeminiChatReply(options);
}

/**
 * Generates structured JSON output from Gemini.
 */
export async function generateGeminiStructuredOutput<T>(
  options: GenerateStructuredOutputOptions<T>
): Promise<T | null> {
  const effectiveTimeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const effectiveTemperature = options.temperature ?? 0.1;
  const effectiveModel = options.model ?? DEFAULT_GEMINI_MODEL;
  const client = (options.client as GoogleGenAI) ?? getGeminiClient();

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
        `[AI Provider: Gemini] Structured generation blocked by safety filters (blockReason: ${blockReason}, finishReason: ${finishReason})`
      );
      return options.fallback ?? null;
    }

    const rawText = response.text?.trim();
    if (!rawText) {
      console.warn(
        `[AI Provider: Gemini] Structured generation returned empty text (finishReason: ${finishReason ?? "unknown"})`
      );
      return options.fallback ?? null;
    }

    const cleanedText = cleanJsonString(rawText);
    const parsedJson = JSON.parse(cleanedText);
    const validated = options.schema.parse(parsedJson);

    return validated;
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      console.warn(`[AI Provider: Gemini] Structured generation timed out after ${effectiveTimeoutMs}ms`);
    } else if (error instanceof z.ZodError) {
      console.warn("[AI Provider: Gemini] Structured output failed Zod validation:", error.format());
    } else if (error instanceof SyntaxError) {
      console.warn("[AI Provider: Gemini] Structured output failed JSON parsing:", error.message);
    } else {
      console.error("[AI Provider: Gemini] Unexpected error during generateStructuredOutput:", error);
    }

    return options.fallback ?? null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Generates structured JSON output from Groq.
 */
export async function generateGroqStructuredOutput<T>(
  options: GenerateStructuredOutputOptions<T>
): Promise<T | null> {
  const effectiveTimeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const effectiveTemperature = options.temperature ?? 0.1;
  const effectiveModel = options.model ?? DEFAULT_GROQ_MODEL;
  const client = (options.client as Groq) ?? getGroqClient();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const jsonSchema = zodToGroqSchema(options.schema);

    const systemPromptText =
      options.systemPrompt && options.systemPrompt.trim().length > 0
        ? `${options.systemPrompt.trim()}\nYou must return only valid JSON adhering to the provided JSON schema.`
        : `You are a structured data extractor. You must return only valid JSON adhering to the provided JSON schema.`;

    const messages = [
      { role: "system" as const, content: systemPromptText },
      { role: "user" as const, content: options.prompt },
    ];

    const generatePromise = client.chat.completions.create(
      {
        model: effectiveModel,
        messages: messages as any,
        temperature: effectiveTemperature,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_output",
            schema: jsonSchema,
          },
        },
      },
      {
        signal: controller.signal,
        timeout: effectiveTimeoutMs,
      }
    );

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

    const choice = response.choices?.[0];
    const finishReason = choice?.finish_reason;

    if ((finishReason as string) === "content_filter") {
      console.warn(
        `[AI Provider: Groq] Structured generation blocked by safety filters (finish_reason: ${finishReason})`
      );
      return options.fallback ?? null;
    }

    const rawText = choice?.message?.content?.trim();
    if (!rawText) {
      console.warn(
        `[AI Provider: Groq] Structured generation returned empty text (finishReason: ${finishReason ?? "unknown"})`
      );
      return options.fallback ?? null;
    }

    const cleanedText = cleanJsonString(rawText);
    const parsedJson = JSON.parse(cleanedText);
    const validated = options.schema.parse(parsedJson);

    return validated;
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      console.warn(`[AI Provider: Groq] Structured generation timed out after ${effectiveTimeoutMs}ms`);
    } else if (error instanceof z.ZodError) {
      console.warn("[AI Provider: Groq] Structured output failed Zod validation:", error.format());
    } else if (error instanceof SyntaxError) {
      console.warn("[AI Provider: Groq] Structured output failed JSON parsing:", error.message);
    } else {
      console.error("[AI Provider: Groq] Unexpected error during generateStructuredOutput:", error);
    }

    return options.fallback ?? null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Generates structured JSON output from the selected provider (Gemini or Groq),
 * enforced by schema definitions at the model level and strictly validated at runtime using Zod.
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
  const provider = resolveProvider(options);
  if (provider === "groq") {
    return generateGroqStructuredOutput(options);
  }
  return generateGeminiStructuredOutput(options);
}
