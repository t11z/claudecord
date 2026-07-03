# claudecord

Self-hosted @claude for Discord. Mention the bot → it opens a thread → Claude answers with per-thread memory. Engine is the Claude Agent SDK (wraps the Claude Code CLI), auth via `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or `ANTHROPIC_API_KEY` fallback.

## Commands

- `npm run dev` — bot with tsx watch (needs `.env`)
- `npm run dev:dashboard` — Vite dev server for the dashboard, proxies /api
- `npm test` — vitest, all mocked, no tokens needed
- `npm run lint` / `npm run lint:fix` — Biome (lint + format, no ESLint/Prettier)
- `npm run typecheck` — tsc --noEmit (bot + dashboard)
- `npm run build` — dashboard → `packages/bot/public/`, then bot → `dist/`
- Run a single test file: `npm test -w @claudecord/bot -- tests/splitter.test.ts`
- `/new-slash-command` — scaffolds a new Discord slash command (file + registration + docs)

## Layout

npm workspaces, no monorepo tooling. `packages/bot` is the app (Discord client + Hono dashboard API in ONE process). `packages/dashboard` is Preact+Vite, builds into `packages/bot/public/`. `docs/` is Astro Starlight → GitHub Pages.

## Rules

- ALL Agent SDK access goes through `packages/bot/src/claude/runner.ts`. Never import `@anthropic-ai/claude-agent-sdk` anywhere else — the SDK moves fast and this is the only file allowed to break on upgrades.
- The SDK version is pinned exactly in package.json. Do not widen it.
- Never call the plain Anthropic Messages API — OAuth tokens don't work with it. That's the whole point of this project.
- `cwd` for a thread session must NEVER change once created. Claude Code keys session storage by cwd path (`~/.claude/projects/<hash>`); changing it silently breaks `resume`.
- DB is better-sqlite3, synchronous, no ORM. Migrations: append to the array in `src/db/migrations.ts`, never edit an existing entry (PRAGMA user_version).
- Tokens live in env vars or `DATA_DIR/secrets.json` — never in the SQLite DB, never in logs (pino redact list in logger.ts).
- Message splitting must never break a code fence. `splitter.ts` is pure and TDD'd — change it test-first.
- Dashboard API DTOs live in `packages/bot/src/types.ts` (runtime-import-free); the frontend imports them type-only. Keep both sides in sync in the same PR.
- ESM everywhere (`"type": "module"`). Local imports need `.js` extensions.

## Gotchas

- MessageContent is a privileged Discord intent — must be toggled in the Dev Portal or the client throws `Used disallowed intents` at login.
- Each `query()` spawns a Claude Code CLI subprocess. The global semaphore (MAX_CONCURRENT_RUNS, default 4) is load-bearing; don't bypass the queue.
- Rate-limit errors from the CLI arrive as unstructured text, not typed errors. `claude/errors.ts` parses defensively — add new patterns WITH a fixture test in `tests/errors.test.ts`.
- Discord edits are rate-limited (~5/5s per channel). ThrottledEditor widens its interval on backpressure; never edit a message in a loop without it.
- Docker needs volumes for BOTH `/data` and `/home/bot/.claude` — losing the latter kills all session resume.
