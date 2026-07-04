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
| `index.ts` | Boot order: env → context → web server → auth check → Discord |
| `context.ts` | The `AppContext` object threaded through everything (DB repos, queue, engine, active runs) |
| `env.ts` | zod-validated environment |
| `secrets.ts` | `secrets.json` store + env-over-file credential resolution |
| `claude/runner.ts` | **The only file that imports the Agent SDK.** Builds `query()` options, consumes the message stream |
| `claude/errors.ts` | Defensive text classification of CLI failures (rate limit / auth / abort) |
| `claude/auth-check.ts` | One-turn probe query to validate credentials |
| `discord/client.ts` | Intents, event wiring, disallowed-intent error translation |
| `discord/handlers/mention.ts` | @mention → thread → session row → first turn |
| `discord/handlers/thread-message.ts` | Follow-ups in mapped threads |
| `discord/conversation.ts` | One turn: reactions, typing indicator, queue, stream, deliver |
| `discord/splitter.ts` | Fence-safe 2000-char splitting + `closeOpenFences` (pure, TDD) |
| `discord/progress.ts` | `TypingIndicator` (native "typing…") + `StreamingReply` — edit-based streaming with backoff |
| `discord/attachments.ts` | Discord attachments → prompt text / image blocks |
| `queue/queue.ts` | Per-guild serial queue + global semaphore |
| `db/` | Migrations (PRAGMA `user_version`) + repos |
| `web/` | Hono API, cookie auth, static dashboard |

## The life of a message

1. `messageCreate` fires. Bots and DMs are dropped immediately.
2. If the channel is a thread with a `thread_sessions` row → follow-up turn.
   Otherwise, if the bot is mentioned → new conversation: create thread,
   insert session row (`mode` = chat or agentic from guild config, `cwd` =
   `DATA_DIR/workspaces/<guild>/<thread>`).
3. `conversation.ts` reacts 👀 (⏳ while queued), builds the prompt
   (attachments inlined / imaged), and enqueues the run keyed by guild ID.
4. `runner.ts` calls the Agent SDK's `query()` with `resume` set to the
   stored Claude session ID (absent on turn one). The `system/init` message
   yields the session ID, persisted immediately, and starts the native
   `TypingIndicator` ("Bot is typing…") — no placeholder message is posted
   during the thinking/tool phase.
5. `stream_event` text deltas feed the `StreamingReply`, which lazily creates
   one message on the first token and edits it every ~1.5 s (widening on
   rate-limit backpressure), keeping the live preview fence-safe.
   `tool_use` blocks surface as a small activity line on that message.
6. The `result` message ends the run: usage is logged, the final text is
   split fence-safely (or attached as `response.md`), reactions flip to
   ✅/❌. Rate-limit failures pause the queue for a minute.

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
