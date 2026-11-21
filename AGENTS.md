# AGENTS.md — AI Discord Bot Workspace Rules

## 1. Project Overview

This repository is an AI-powered Discord chatbot built with **Seyfert**, running on the **Bun** runtime. It features an abstracted multi-provider LLM backend (`@google/genai` and `groq-sdk`), an in-memory rolling channel buffer, and a persistent SQLite player memory system (`bun:sqlite`) tracking dossiers, facts, and affinity.

This document defines the strict engineering architecture, layer boundaries, and execution rules for AI coding agents. Do not add bot personality details or gameplay lore here; keep this guide strictly technical.

---

## 2. File Exploration, Search & Context7 Protocol (CRITICAL)

To prevent slow execution and context pollution, follow these navigation rules strictly:

- **FORBIDDEN DIRECTORIES:** NEVER read, list, grep, or search inside `node_modules/`, `.git/`, `dist/`, `build/`, `data/` (SQLite data), or lockfiles (`bun.lockb`, `bun.lock`).
- **Scoped Searches Only:** When using file-search or text-search tools, ALWAYS restrict the path parameter to `src/` or `tests/`. Never run root-level unfiltered searches.
- **No Codebase Tours:** Do NOT proactively list directories or read files "to understand the codebase." Use Section 4 (Architecture & Directory Boundaries) below as your map, and open only the exact 1–3 files directly required for the user's prompt.
- **Context7 Over `node_modules`:** If you need external library documentation, API signatures, decorator syntax, or type definitions (especially for `seyfert`, `bun`, `@google/genai`, `groq-sdk`, or `zod-to-json-schema`), **NEVER look inside `node_modules/`**. Query the **Context7** MCP tool instead.
  - *How to use Context7:* Use `resolve-library-id` with the package name (e.g., `seyfert` or `bun`), then use `query-docs` to retrieve documentation for specific methods, types, or decorators.
  - *When to use Context7:* Whenever you are unsure of a Seyfert decorator (`@Declare`, `@Options`), client method, REST API route (`message.reply`, `message.write`), event structure (`createEvent`), or third-party SDK signature.
  - *When NOT to use Context7:* Skip it for standard TypeScript syntax, native JavaScript, basic `zod` schemas, or patterns already demonstrated in existing `src/` files.

---

## 3. Core Tech Stack & Runtime Invariants

- **Runtime & Package Manager:** Bun (`bun run`, `bun test`, `bun add`).
  - ALWAYS use Bun native APIs: `bun:sqlite` for SQLite database access, `Bun.env` for environment variables, and `bun test` for unit/integration tests.
  - NEVER install or use `dotenv`, `ts-node`, `nodemon`, `better-sqlite3`, or `jest`.
  - Always invoke CLI tools via `bun x <pkg>` instead of standalone `bunx`.
- **Language & Decorators:** TypeScript (strict mode).
  - **CRITICAL BUN + SEYFERT RULE:** `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` MUST remain explicitly defined at the top-level root `tsconfig.json`. Never move them into an extended base config, or Bun's transpiler will fail to emit Seyfert command decorator metadata.
- **Discord Framework:** **Seyfert** (`seyfert`).
  - NEVER write or hallucinate `discord.js`, `eris`, or `oceanic.js` code.
  - Commands use class decorators: `@Declare({ name, description })` extending `Command` with `override async run(ctx: CommandContext)`.
  - Events use `createEvent({ data: { name, once? }, run(payload, client) })`.
  - Sending messages: use `ctx.write()`, `message.reply()`, `message.write()`, or `client.messages.write(channelId, payload)`.
- **AI & LLM Providers:**
  - `@google/genai` (Google Gen AI SDK) and `groq-sdk` abstracted under `src/ai/provider.ts`.
  - Structured LLM output validated via `zod` and converted to JSON schema with `zod-to-json-schema`.
- **Configuration & Environment:**
  - Centralized in `src/env.ts` with Zod schema validation (`envSchema`).
  - ALWAYS import `env` from `src/env` (e.g. `import { env } from "./env";`). Never access untyped `process.env` directly.

---

## 4. Architecture & Directory Boundaries (Use as Map)

Do not scan the filesystem to find where things live. Use this map as your architectural blueprint:

- `src/index.ts` — Seyfert `Client` bootstrap, graceful shutdown handlers (`SIGINT`, `SIGTERM`), database startup, and command upload (`client.uploadCommands()`).
- `src/env.ts` — Zod schema validation for environment variables (`DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEFAULT_AI_PROVIDER`, `DATABASE_PATH`, `NODE_ENV`).
- `src/commands/` — Seyfert slash commands (`ping.ts`, `forget.ts`).
- `src/events/` — Seyfert gateway event listeners (`botReady.ts`, `messageCreate.ts`).
- `src/chat/` — Chat orchestration pipeline:
  - `trigger.ts`: Determines whether a message triggers a bot response (mentions `<@botId>`, replies to bot messages, DMs; ignores other bots and general chatter).
  - `rateLimiter.ts`: In-memory sliding-window rate limiter per channel and user.
  - `dispatch.ts`: Main response coordinator (triggers typing state, loads channel buffer & player dossier, calls AI generator, splits message, sends reply chunks, and enqueues async memory extraction).
  - `index.ts`: Barrel export.
- `src/ai/` — LLM layer (**Zero direct Seyfert / Discord dependencies allowed here**):
  - `provider.ts`: Multi-provider LLM abstraction (Gemini `@google/genai` and Groq `groq-sdk`) for chat text generation and structured JSON output.
  - `prompt.ts`: System prompt composer (injects player dossier, known memories, and recent channel buffer into system prompt).
  - `extractor.ts`: Structured memory extraction pipeline that extracts player facts, summary updates, and affinity deltas via LLM.
  - `index.ts`: Barrel export.
- `src/memory/` — Persistence & short-term buffers (**Zero direct Seyfert / Discord dependencies allowed here**):
  - `db.ts`: `bun:sqlite` database connection and automated schema migrations (`players`, `memories`, `affinities` tables).
  - `buffer.ts`: In-memory rolling channel message buffer with automatic TTL / cleanup timers.
  - `playerRepo.ts`: Repository for player dossiers, memory facts, and affinity CRUD operations.
  - `types.ts`, `index.ts`: Type definitions and exports.
- `src/utils/` — Pure helper utilities:
  - `splitter.ts`: Smart message splitting for Discord's 2,000-character limit (`splitMessage`, code-block and paragraph aware).
  - `sanitizer.ts`: Mention sanitization (`sanitizeMentions` to neutralize `@everyone`, `@here`, role/user mentions).
  - `index.ts`: Barrel export.
- `tests/` — `bun:test` test suites covering utils, env validation, chat triggers, dispatch pipeline, rate limiting, buffers, player repository, prompt composition, provider abstraction, and memory extractor.

---

## 5. Strict Layer Decoupling Invariants

1. **`src/ai/` must never import `seyfert` or Discord types.** It must accept pure primitives (strings, numbers, plain objects) and return pure strings or validated JSON objects.
2. **`src/memory/` must never import `seyfert` or Discord types.** It operates exclusively on plain TypeScript data types and `bun:sqlite`.
3. **Discord transport isolation:** Only `src/events/`, `src/commands/`, and `src/chat/` are allowed to touch Seyfert types (`Message`, `CommandContext`, `Client`, channel IDs).

---

## 6. Coding Standards & Execution Guardrails

1. **Direct Action Only:** Address only what was asked. Avoid speculative refactors, broad codebase audits, over-explaining, or reading unrelated files.
2. **Non-Blocking Memory Extraction:** Never delay a Discord chat reply to extract or save long-term player memories. Always send the chat response to Discord first, then trigger memory/affinity extraction asynchronously in the background (`queueMicrotask` or fire-and-forget async handler with internal `try/catch`).
3. **Discord Message Limits & Sanitization:** Discord rejects messages >2,000 characters. All AI responses MUST pass through `splitMessage()` before sending. All outbound mentions MUST pass through `sanitizeMentions()`.
4. **Fault Tolerance & Graceful Degradation:** Wrap all external LLM calls and background extractors in `try/catch` blocks. A failed LLM call or malformed JSON output must never crash the Seyfert gateway process; log the error and send a user-friendly fallback reply.
5. **Targeted Verification:** After modifying code, run type-checks and relevant tests:
   - Type check: `bun x tsc --noEmit`
   - Targeted test: `bun test <path-to-test-file>` (only run full `bun test` if core shared utilities or memory layers were changed).
