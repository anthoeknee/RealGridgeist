import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import type { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import {
  generateChatReply,
  generateStructuredOutput,
  buildChatContents,
  cleanJsonString,
  zodToGeminiSchema,
  isTimeoutOrAbortError,
  isSafetyErrorMessage,
  FALLBACK_MESSAGES,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  getAiClient,
  setAiClient,
} from "../src/ai/provider";

function createMockResponse(options: {
  text?: string;
  finishReason?: string;
  blockReason?: string;
}): GenerateContentResponse {
  return {
    text: options.text,
    candidates: [
      {
        finishReason: options.finishReason as any,
        content: {
          role: "model",
          parts: options.text ? [{ text: options.text }] : [],
        },
      },
    ],
    promptFeedback: options.blockReason
      ? { blockReason: options.blockReason as any }
      : undefined,
  } as unknown as GenerateContentResponse;
}

describe("AI Provider Module (src/ai/provider.ts)", () => {
  beforeEach(() => {
    setAiClient(null);
  });

  afterEach(() => {
    setAiClient(null);
  });

  describe("Schema and Utility Functions", () => {
    it("zodToGeminiSchema converts Zod schema to JSON schema and strips top-level $schema", () => {
      const testSchema = z.object({
        playerName: z.string().describe("Player username"),
        affinityDelta: z.number().int().min(-20).max(20),
        facts: z.array(z.string()),
        isVip: z.boolean().default(false),
      });

      const schema = zodToGeminiSchema(testSchema);

      expect(schema).toBeDefined();
      expect(schema.$schema).toBeUndefined();
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();

      const props = schema.properties as Record<string, any>;
      expect(props.playerName.type).toBe("string");
      expect(props.affinityDelta.type).toBe("integer");
      expect(props.facts.type).toBe("array");
      expect(props.isVip.type).toBe("boolean");
    });

    it("cleanJsonString strips markdown code fences and whitespace", () => {
      expect(cleanJsonString('{"key": "value"}')).toBe('{"key": "value"}');
      expect(cleanJsonString('  ```json\n{"key": "value"}\n```  ')).toBe('{"key": "value"}');
      expect(cleanJsonString('```\n{"key": "value"}\n```')).toBe('{"key": "value"}');
      expect(cleanJsonString('   {"a": 1}   ')).toBe('{"a": 1}');
    });

    it("isTimeoutOrAbortError correctly identifies timeout and abort conditions", () => {
      const domAbort = new DOMException("The operation was aborted.", "AbortError");
      const errTimeout = new Error("Request timed out after 5000ms");
      const errDeadline = new Error("DEADLINE EXCEEDED during stream");
      const standardErr = new Error("General socket error");

      expect(isTimeoutOrAbortError(domAbort)).toBe(true);
      expect(isTimeoutOrAbortError(errTimeout)).toBe(true);
      expect(isTimeoutOrAbortError(errDeadline)).toBe(true);
      expect(isTimeoutOrAbortError(standardErr)).toBe(false);
      expect(isTimeoutOrAbortError(null)).toBe(false);
    });

    it("isSafetyErrorMessage identifies moderation and policy block messages", () => {
      expect(isSafetyErrorMessage("SAFETY: Content flagged by category HARM_CATEGORY_DANGEROUS")).toBe(true);
      expect(isSafetyErrorMessage("Candidate was blocked by policy")).toBe(true);
      expect(isSafetyErrorMessage("PROHIBITED content detected")).toBe(true);
      expect(isSafetyErrorMessage("Network connection reset")).toBe(false);
    });
  });

  describe("Chat History Normalization (buildChatContents)", () => {
    it("creates a single user turn when no conversation history is provided", () => {
      const contents = buildChatContents("Hello Gridgeist!");
      expect(contents.length).toBe(1);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts?.[0]?.text).toBe("Hello Gridgeist!");
    });

    it("normalizes ChatHistoryMessage turns and maps assistant to model", () => {
      const history = [
        { role: "user" as const, content: "Are you online?" },
        { role: "assistant" as const, content: "System operational." },
      ];

      const contents = buildChatContents("What is my status?", history);
      expect(contents.length).toBe(3);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts?.[0]?.text).toBe("Are you online?");
      expect(contents[1]?.role).toBe("model");
      expect(contents[1]?.parts?.[0]?.text).toBe("System operational.");
      expect(contents[2]?.role).toBe("user");
      expect(contents[2]?.parts?.[0]?.text).toBe("What is my status?");
    });

    it("formats buffered channel messages with author names for human messages", () => {
      const buffer = [
        { isBot: false, authorName: "Alice", content: "Check the server log" },
        { isBot: true, authorName: "Gridgeist", content: "Log scanned. 0 faults." },
        { isBot: false, authorName: "Bob", content: "Good job ghost." },
      ];

      const contents = buildChatContents("Who is leading the raid?", buffer);
      expect(contents.length).toBe(3);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts?.[0]?.text).toBe("Alice: Check the server log");
      expect(contents[1]?.role).toBe("model");
      expect(contents[1]?.parts?.[0]?.text).toBe("Log scanned. 0 faults.");
      expect(contents[2]?.role).toBe("user");
      // Bob + latest user turn coalesced into consecutive user turn
      expect(contents[2]?.parts?.length).toBe(2);
      expect(contents[2]?.parts?.[0]?.text).toBe("Bob: Good job ghost.");
      expect(contents[2]?.parts?.[1]?.text).toBe("Who is leading the raid?");
    });

    it("ensures conversation starts with user turn even if history starts with model", () => {
      const history = [
        { role: "model" as const, content: "Grid initialized." },
        { role: "user" as const, content: "Status report?" },
      ];

      const contents = buildChatContents("Ping", history);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts?.[0]?.text).toBe("[Prior conversation context]");
      expect(contents[1]?.role).toBe("model");
      expect(contents[1]?.parts?.[0]?.text).toBe("Grid initialized.");
      expect(contents[2]?.role).toBe("user");
    });
  });

  describe("generateChatReply", () => {
    it("successfully generates a chat response from Gemini", async () => {
      let capturedParams: any = null;

      const mockClient = {
        models: {
          generateContent: async (params: any) => {
            capturedParams = params;
            return createMockResponse({
              text: "The grid hums with electricity. What do you seek, traveler?",
              finishReason: "STOP",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const reply = await generateChatReply({
        client: mockClient,
        systemPrompt: "You are Gridgeist, a digital spirit living in the Discord server.",
        userMessage: "Hello!",
        temperature: 0.85,
        timeoutMs: 8000,
      });

      expect(reply).toBe("The grid hums with electricity. What do you seek, traveler?");
      expect(capturedParams).toBeDefined();
      expect(capturedParams.model).toBe(DEFAULT_MODEL);
      expect(capturedParams.config.systemInstruction).toBe(
        "You are Gridgeist, a digital spirit living in the Discord server."
      );
      expect(capturedParams.config.temperature).toBe(0.85);
      expect(capturedParams.config.httpOptions.timeout).toBe(8000);
      expect(capturedParams.config.abortSignal).toBeDefined();
    });

    it("gracefully returns in-character fallback on timeout", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            // Simulate hanging promise longer than timeout
            await new Promise((resolve) => setTimeout(resolve, 150));
            return createMockResponse({ text: "Late response" });
          },
        },
      } as unknown as GoogleGenAI;

      const reply = await generateChatReply({
        client: mockClient,
        userMessage: "Are you there?",
        timeoutMs: 30, // Quick timeout for test
      });

      expect(reply).toBe(FALLBACK_MESSAGES.TIMEOUT);
    });

    it("gracefully returns custom fallbackMessage on timeout if provided", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            return createMockResponse({ text: "Late response" });
          },
        },
      } as unknown as GoogleGenAI;

      const customFallback = "*Custom offline message*";
      const reply = await generateChatReply({
        client: mockClient,
        userMessage: "Hello?",
        timeoutMs: 30,
        fallbackMessage: customFallback,
      });

      expect(reply).toBe(customFallback);
    });

    it("gracefully returns safety fallback when blocked by promptFeedback safety filters", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              blockReason: "SAFETY",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const reply = await generateChatReply({
        client: mockClient,
        userMessage: "Generate malicious exploit",
      });

      expect(reply).toBe(FALLBACK_MESSAGES.SAFETY_BLOCKED);
    });

    it("gracefully returns safety fallback when candidate finishReason is SAFETY", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              finishReason: "SAFETY",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const reply = await generateChatReply({
        client: mockClient,
        userMessage: "Flagged input",
      });

      expect(reply).toBe(FALLBACK_MESSAGES.SAFETY_BLOCKED);
    });

    it("gracefully returns generic fallback on unexpected API error without throwing", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            throw new Error("HTTP 503 Service Unavailable");
          },
        },
      } as unknown as GoogleGenAI;

      const reply = await generateChatReply({
        client: mockClient,
        userMessage: "Hello",
      });

      expect(reply).toBe(FALLBACK_MESSAGES.GENERIC_ERROR);
    });

    it("returns generic fallback when model produces empty text", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              text: "",
              finishReason: "OTHER",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const reply = await generateChatReply({
        client: mockClient,
        userMessage: "Empty test",
      });

      expect(reply).toBe(FALLBACK_MESSAGES.GENERIC_ERROR);
    });
  });

  describe("generateStructuredOutput", () => {
    const memoryExtractionSchema = z.object({
      affinityDelta: z.number().int().min(-20).max(20),
      detectedFacts: z.array(z.string()),
      playerMood: z.enum(["friendly", "neutral", "hostile"]),
    });

    it("generates and validates structured JSON output matching Zod schema", async () => {
      let capturedConfig: any = null;

      const mockClient = {
        models: {
          generateContent: async (params: any) => {
            capturedConfig = params.config;
            return createMockResponse({
              text: JSON.stringify({
                affinityDelta: 5,
                detectedFacts: ["Alice enjoys coffee", "Plays healer class"],
                playerMood: "friendly",
              }),
              finishReason: "STOP",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const result = await generateStructuredOutput({
        client: mockClient,
        prompt: "Extract memory facts from: 'Alice: I love brewing coffee while healing in raids!'",
        schema: memoryExtractionSchema,
      });

      expect(result).not.toBeNull();
      expect(result?.affinityDelta).toBe(5);
      expect(result?.detectedFacts).toEqual(["Alice enjoys coffee", "Plays healer class"]);
      expect(result?.playerMood).toBe("friendly");

      expect(capturedConfig.responseMimeType).toBe("application/json");
      expect(capturedConfig.responseJsonSchema).toBeDefined();
      expect(capturedConfig.responseJsonSchema.$schema).toBeUndefined();
    });

    it("handles model response wrapped in markdown json fences", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              text: "```json\n{\n  \"affinityDelta\": -2,\n  \"detectedFacts\": [\"Dislikes lag\"],\n  \"playerMood\": \"neutral\"\n}\n```",
              finishReason: "STOP",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const result = await generateStructuredOutput({
        client: mockClient,
        prompt: "Extract facts",
        schema: memoryExtractionSchema,
      });

      expect(result).not.toBeNull();
      expect(result?.affinityDelta).toBe(-2);
      expect(result?.detectedFacts).toEqual(["Dislikes lag"]);
      expect(result?.playerMood).toBe("neutral");
    });

    it("returns null when model output fails Zod schema validation and no fallback is given", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              text: JSON.stringify({
                affinityDelta: 999, // Out of [-20, 20] range!
                detectedFacts: "not-an-array", // Should be array!
                playerMood: "unknown_mood", // Not in enum!
              }),
              finishReason: "STOP",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const result = await generateStructuredOutput({
        client: mockClient,
        prompt: "Extract facts",
        schema: memoryExtractionSchema,
      });

      expect(result).toBeNull();
    });

    it("returns provided fallback when Zod schema validation fails", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              text: JSON.stringify({ invalid: true }),
            });
          },
        },
      } as unknown as GoogleGenAI;

      const defaultFallback = {
        affinityDelta: 0,
        detectedFacts: [],
        playerMood: "neutral" as const,
      };

      const result = await generateStructuredOutput({
        client: mockClient,
        prompt: "Extract facts",
        schema: memoryExtractionSchema,
        fallback: defaultFallback,
      });

      expect(result).toEqual(defaultFallback);
    });

    it("returns fallback on timeout during structured output generation", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            return createMockResponse({ text: "{}" });
          },
        },
      } as unknown as GoogleGenAI;

      const defaultFallback = {
        affinityDelta: 0,
        detectedFacts: [],
        playerMood: "neutral" as const,
      };

      const result = await generateStructuredOutput({
        client: mockClient,
        prompt: "Extract facts",
        schema: memoryExtractionSchema,
        timeoutMs: 30,
        fallback: defaultFallback,
      });

      expect(result).toEqual(defaultFallback);
    });

    it("returns null on safety block during structured output generation", async () => {
      const mockClient = {
        models: {
          generateContent: async () => {
            return createMockResponse({
              finishReason: "SAFETY",
            });
          },
        },
      } as unknown as GoogleGenAI;

      const result = await generateStructuredOutput({
        client: mockClient,
        prompt: "Extract facts from sensitive data",
        schema: memoryExtractionSchema,
      });

      expect(result).toBeNull();
    });
  });

  describe("Client Singleton and Override", () => {
    it("getAiClient caches client instance and setAiClient allows overriding", () => {
      const client1 = getAiClient();
      const client2 = getAiClient();
      expect(client1).toBe(client2);

      const customMock = {} as GoogleGenAI;
      setAiClient(customMock);
      expect(getAiClient()).toBe(customMock);
    });
  });
});
