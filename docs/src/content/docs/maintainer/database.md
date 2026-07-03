---
title: Database
description: Schema, migration conventions and repo patterns.
---

SQLite via `better-sqlite3` — synchronous, zero-config, one file in
`DATA_DIR`. No ORM: four tables don't justify one, and hand-written SQL in
repo classes keeps everything greppable.

## Schema

### `thread_sessions`

The heart of the bot: one row per Discord thread that maps to a Claude
session.

| Column | Notes |
| --- | --- |
| `thread_id` PK | Discord thread ID |
| `guild_id`, `channel_id` | provenance |
| `claude_session_id` | set from the SDK's `system/init` message; NULL before the first turn completes |
| `model` | frozen at thread creation |
| `mode` | `chat` or `agentic`, frozen at thread creation |
| `cwd` | per-thread workspace path — **immutable** (see Agent SDK docs) |
| `created_at`, `last_active_at`, `turn_count` | housekeeping & pruning |

### `guild_config`

Per-server settings: `enabled`, `allowed_channel_ids` / `allowed_role_ids`
(JSON arrays), `agentic_enabled`, `model` override, `system_prompt_extra`.
Absent row = defaults (enabled, everything allowed, chat-only).

### `usage_log`

One row per run: tokens, cost, duration, `ok`, `error_kind`. Powers `/usage`
and the dashboard stats. Contains IDs only — no message content.

### `app_config`

Key/value for non-secret app state (e.g. the dashboard cookie-signing
secret). **Never put tokens here.**

## Migration conventions

Migrations live as an ordered SQL array in `src/db/migrations.ts`, versioned
with `PRAGMA user_version`:

- **Append only.** Never edit an existing entry — deployed databases have
  already run it.
- Each migration runs in a transaction; version bumps atomically with it.
- Keep them plain SQL. No data backfills mixed with DDL unless unavoidable.

## Repo pattern

Each table gets a small class in `src/db/repos/` taking the `Database` in
its constructor, exposing typed methods, and converting rows to camelCase
interfaces at the boundary. Tests run against `openMemoryDatabase()` —
see `tests/repos.test.ts` for the style.
