# AGENTS.md — AI Discord Bot Workspace Rules

## 1. Project Overview

We are building an interactive, AI-powered Discord chatbot with a dynamic personality and persistent player memory (short-term channel buffers + long-term player dossiers & affinity).

## 2. Core Tech Stack & Runtime Invariants

- **Runtime & Package Manager:** Bun (`bun run`, `bun test`, `bun add`).
  - ALWAYS use Bun native APIs: `bun:sqlite` for SQLite database access, `Bun.env` for environment variables, and `bun test` for unit/integration tests.
  - NEVER install or use `dotenv`, `ts-node`, `nodemon`, `better-sqlite3`, or `jest`.
  - Always invoke commands via `bun x` instead of standalone `bunx`.
- **Language:** TypeScript (strict mode).
  - CRITICAL BUN + SEYFERT RULE: `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` MUST remain explicitly defined at the top-level root `tsconfig.json`. Never move them into an extended base config, or Bun's transpiler will fail to emit Seyfert command decorator metadata.
- **Discord Framework:** **Seyfert** (`seyfert`).
  - NEVER write or hallucinate `discord.js`, `eris`, or `oceanic.js` code.
  - Execute TypeScript directly from `src` in development (`locations.base: "src"` in `seyfert.config.ts`).
- **Validation:** `zod` for all environment variable checks, database JSON payloads, and structured LLM outputs.

## 3. Agent Execution Principles & Context7 Usage

- **Scope & Direct Action:** Address only what was asked. Avoid speculative refactors, broad codebase audits, over-explaining, or touching unrelated files.
- **Context7 On-Demand Only:** Do NOT query Context7 proactively for routine or familiar tasks. Query Context7 only when encountering unknown API signatures, version mismatches, or explicitly unresolved framework errors.
- **Pragmatic Verification:** Run type-checks or tests only on the modified scope or when relevant to the change, avoiding redundant full test sweeps for trivial edits.

## 4. Architecture & Directory Boundaries

Keep Discord transport logic strictly decoupled from the AI brain and SQLite memory layer:

- `src/index.ts` — Seyfert `Client` bootstrap, middleware registration, and graceful shutdown.
- `src/commands/` — Seyfert slash commands (`Command`, `@Declare`, `@Options`).
- `src/events/` — Seyfert gateway events (`createEvent`).
- `src/middlewares/` — Seyfert middlewares (cooldowns, rate-limiting, user ban/opt-out checks).
- `src/ai/` — LLM client wrapper, dynamic system prompt composer, and background fact extractor. Zero direct Seyfert dependencies allowed here.
- `src/memory/` — `bun:sqlite` database initialization, migrations, player dossier repository, and in-memory rolling channel message buffers.
- `src/utils/` — Pure helper functions (Discord 2000-char smart chunking, mention sanitizing, logging).
- `tests/` — `bun:test` unit and integration suites.

## 5. Coding Standards & Safety Guardrails

1. **Non-Blocking Memory Extraction:** Never delay a Discord chat reply to extract or save long-term player memories. Always send the chat response to Discord first, then trigger memory/affinity extraction asynchronously in the background (`queueMicrotask` or fire-and-forget async handler with internal `try/catch`).
2. **Discord Message Limits:** Discord rejects messages >2,000 characters. All AI responses MUST pass through our smart message splitter utility (splitting cleanly on paragraph/line breaks and preserving code block fences) before sending.
3. **Fault Tolerance:** Wrap all external LLM calls and background extractors in `try/catch` blocks. A failed LLM call or malformed JSON output must never crash the Seyfert gateway process.
4. **Verification Loop:** After completing any phase or module, execute tests and type-checks:
   - Type check: `bun x tsc --noEmit`
   - Unit tests: `bun test`
