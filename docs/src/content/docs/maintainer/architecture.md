---
title: Architecture
description: Process model, module map and the life of a message.
---

## The one-process model

Everything runs in a single Node process: the discord.js client, the Hono
server for the dashboard API, and the queue that spawns Claude Code
subprocesses. The Preact dashboard is a static build served by that same
Hono server. This keeps self-hosting to "run one container".

```
┌───────────────────────── node (packages/bot) ─────────────────────────┐
│                                                                       │
│  discord.js client ──► handlers ──► RunQueue ──► ClaudeEngine         │
│        ▲                   │            │            │ spawns         │
│        │                   ▼            │            ▼                │
│   Discord API         SQLite (better-sqlite3)   claude CLI subprocess │
│                            ▲                       (Agent SDK)        │
│  Hono /api + static ───────┘                                          │
│  (dashboard)                                                          │
└───────────────────────────────────────────────────────────────────────┘
```

## Module map (`packages/bot/src`)

| Module | Responsibility |
| --- | --- |
| `index.ts` | Boot order: env → context → legacy-credential warning → web server → Discord |
| `context.ts` | The `AppContext` object threaded through everything (DB repos, queue, engine, active runs, per-user identity stores) |
| `env.ts` | zod-validated environment — only instance-wide infrastructure (Discord, optional GitHub App) |
| `secrets.ts` | `secrets.json` store + env-over-file resolution for instance-wide credentials |
| `claude/identity-store.ts` | Per-user linked Claude OAuth tokens (`/link-claude`) — the acting user's token for every run |
| `claude/runner.ts` | **The only file that imports the Agent SDK.** Builds `query()` options (including the per-run `claudeToken`), consumes the message stream |
| `claude/errors.ts` | Defensive text classification of CLI failures (rate limit / auth / abort) |
| `claude/auth-check.ts` | One-turn probe query to validate a single user's token, at link time and on dashboard re-check |
| `discord/client.ts` | Intents, event wiring, disallowed-intent error translation |
| `discord/handlers/mention.ts` | @mention → Claude-link guard → thread → session row → first turn |
| `discord/handlers/thread-message.ts` | Follow-ups in mapped threads |
| `discord/conversation.ts` | One turn: Claude-link guard, reactions, typing indicator, queue, stream, deliver |
| `discord/splitter.ts` | Fence-safe 2000-char splitting + `closeOpenFences` (pure, TDD) |
| `discord/progress.ts` | `TypingIndicator` (native "typing…") + `StreamingReply` — edit-based streaming with backoff |
| `discord/attachments.ts` | Discord attachments → prompt text / image blocks |
| `queue/queue.ts` | Per-user serial queue + global semaphore + per-key rate-limit pause |
| `db/` | Migrations (PRAGMA `user_version`) + repos |
| `web/` | Hono API, cookie auth, static dashboard |

## The life of a message

1. `messageCreate` fires. Bots and DMs are dropped immediately.
2. If the channel is a thread with a `thread_sessions` row → follow-up turn.
   Otherwise, if the bot is mentioned → new conversation: create thread,
   insert session row (`mode` = chat or agentic from guild config, `cwd` =
   `DATA_DIR/workspaces/<guild>/<thread>`).
3. `conversation.ts` looks up the message author's linked Claude token
   (`ctx.claude.getToken`). No link → reply with the link hint and a 🔑
   reaction, stop — no queue slot consumed, no thread left dangling.
4. Otherwise it reacts 👀 (⏳ while queued), builds the prompt (attachments
   inlined / imaged), and enqueues the run keyed by **the author's Discord
   user ID** — not the guild — so one user's queue never blocks another's.
5. `runner.ts` calls the Agent SDK's `query()` with `resume` set to the
   stored Claude session ID (absent on turn one) and `CLAUDE_CODE_OAUTH_TOKEN`
   set to the author's own token. The `system/init` message yields the
   session ID, persisted immediately, and starts the native `TypingIndicator`
   ("Bot is typing…") — no placeholder message is posted during the
   thinking/tool phase.
6. `stream_event` text deltas feed the `StreamingReply`, which lazily creates
   one message on the first token and edits it every ~1.5 s (widening on
   rate-limit backpressure), keeping the live preview fence-safe.
   `tool_use` blocks surface as a small activity line on that message.
7. The `result` message ends the run: usage is logged (attributed to the
   author), the final text is split fence-safely (or attached as
   `response.md`), reactions flip to ✅/❌. Rate-limit failures pause *that
   user's* queue key for a minute — other users keep running.

## Design rules worth defending in review

- **SDK isolation:** nothing outside `claude/runner.ts` imports the Agent
  SDK. Its version is pinned exactly.
- **Stable `cwd`:** a thread's workspace path never changes — Claude Code
  keys session storage by it.
- **Pure core, mocked edges:** `splitter`, `queue`, `access-control`,
  `errors` are pure and unit-tested; Discord and the SDK are mocked
  behind interfaces.
- **Secrets discipline:** tokens live in env or `secrets.json` (0600), never
  in SQLite, never in logs (pino redaction).
- **No shared credential:** Claude and GitHub tokens are per-user only
  (`claude/identity-store.ts`, `github/identity-store.ts`). There is no
  instance-wide fallback for either — a run with no linked token doesn't run.
