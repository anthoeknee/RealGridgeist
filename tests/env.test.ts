import { describe, expect, it } from "bun:test";
import { envSchema, parseEnv } from "../src/env";

describe("Environment Variable Validation", () => {
  it("successfully parses valid environment variables", () => {
    const validRaw = {
      DISCORD_BOT_TOKEN: "mock-token-123",
      GEMINI_API_KEY: "mock-gemini-key",
      DATABASE_PATH: "./custom/path.sqlite",
      NODE_ENV: "production",
    };

    const parsed = parseEnv(validRaw);
    expect(parsed.DISCORD_BOT_TOKEN).toBe("mock-token-123");
    expect(parsed.GEMINI_API_KEY).toBe("mock-gemini-key");
    expect(parsed.DATABASE_PATH).toBe("./custom/path.sqlite");
    expect(parsed.NODE_ENV).toBe("production");
  });

  it("applies default values for DATABASE_PATH and NODE_ENV", () => {
    const minimalRaw = {
      DISCORD_BOT_TOKEN: "mock-token-123",
      GEMINI_API_KEY: "mock-gemini-key",
    };

    const parsed = parseEnv(minimalRaw);
    expect(parsed.DATABASE_PATH).toBe("./data/bot.sqlite");
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.DEFAULT_AI_PROVIDER).toBe("gemini");
    expect(parsed.GROQ_API_KEY).toBeUndefined();
  });

  it("parses optional GROQ_API_KEY and custom DEFAULT_AI_PROVIDER", () => {
    const groqRaw = {
      DISCORD_BOT_TOKEN: "mock-token-123",
      GEMINI_API_KEY: "mock-gemini-key",
      GROQ_API_KEY: "mock-groq-key",
      DEFAULT_AI_PROVIDER: "groq",
    };

    const parsed = parseEnv(groqRaw);
    expect(parsed.GROQ_API_KEY).toBe("mock-groq-key");
    expect(parsed.DEFAULT_AI_PROVIDER).toBe("groq");
  });

  it("throws descriptive error when required variables are missing", () => {
    const invalidRaw = {
      DISCORD_BOT_TOKEN: "",
    };

    expect(() => parseEnv(invalidRaw)).toThrow("Invalid environment configuration");
  });
});
