import { z } from "zod";

export const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  DATABASE_PATH: z.string().default("./data/bot.sqlite"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined> = Bun.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formattedErrors = result.error.flatten().fieldErrors;
    console.error("❌ Invalid environment variables:", formattedErrors);
    throw new Error(`Invalid environment configuration: ${JSON.stringify(formattedErrors)}`);
  }
  return result.data;
}

// Under test runners without a populated .env, provide placeholder values
const isTestEnv = Bun.env.NODE_ENV === "test";
const baseEnv = isTestEnv
  ? {
      DISCORD_BOT_TOKEN: "test_token",
      GEMINI_API_KEY: "test_key",
      DATABASE_PATH: "./data/test.sqlite",
      NODE_ENV: "test",
      ...Bun.env,
    }
  : Bun.env;

export const env: Env = parseEnv(baseEnv);
