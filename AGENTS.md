# AGENTS.md — AI Discord Bot Workspace Rules

## 1. Project Overview

We are building an interactive, AI-powered Discord chatbot with a dynamic personality and persistent player memory (short-term channel buffers + long-term player dossiers & affinity).

## 2. Core Tech Stack & Runtime Invariants

- **Runtime & Package Manager:** Bun (`bun run`, `bun test`, `bun add`).
  - ALWAYS use Bun native APIs: `bun:sqlite` for SQLite database access, `Bun.env` for environment variables, and `bun test` for unit/integration tests.
  - NEVER install or use `dotenv`, `ts-node`, `nodemon`, `better-sqlite3`, or `jest`.
  - **CLI Execution & Subshell Path Invariant:** Due to macOS sandbox and shim permission restrictions in the agent subshell, NEVER run standalone `bunx` or rely on raw Mise dynamic shims (which fail with `operation not permitted`). Always invoke commands via `bun x` and ensure the direct Bun installation is exposed in the execution subshell:
    - Prepend path when running checks: `PATH="$HOME/.local/share/mise/installs/bun/latest/bin:$PATH"`
- **Language:** TypeScript (strict mode).
  - CRITICAL BUN + SEYFERT RULE: `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` MUST remain explicitly defined at the top-level root `tsconfig.json`. Never move them into an extended base config, or Bun's transpiler will fail to emit Seyfert command decorator metadata.
- **Discord Framework:** **Seyfert** (`seyfert`).
  - NEVER write or hallucinate `discord.js`, `eris`, or `oceanic.js` code.
  - Execute TypeScript directly from `src` in development (`locations.base: "src"` in `seyfert.config.ts`).
- **Validation:** `zod` for all environment variable checks, database JSON payloads, and structured LLM outputs.

## 3. Mandatory Documentation Lookup (Context7 MCP)

- **Always use Context7 first:** Before writing, modifying, or debugging code involving **Seyfert**, **Bun**, **Zod**, or our **LLM SDK** (e.g., `@google/genai` or `ai`), you MUST query the **Context7 MCP** (`resolve-library-id` -> `get-library-docs`) to fetch the latest official documentation and API signatures.
- Never guess Seyfert decorator syntax (`@Declare`, `@Options`, `@Middlewares`), Gateway event names, `seyfert.config.ts` structure, or `CommandContext` methods—verify them via Context7 first.

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
4. **Verification Loop:** After completing any phase or module, execute tests and type-checks using the direct path invocation:
   - Type check: `PATH="$HOME/.local/share/mise/installs/bun/latest/bin:$PATH" bun x tsc --noEmit`
   - Unit tests: `PATH="$HOME/.local/share/mise/installs/bun/latest/bin:$PATH" bun test`
