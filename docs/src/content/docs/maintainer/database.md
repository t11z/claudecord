---
title: Database
description: Schema, migration conventions and repo patterns.
---

SQLite via `better-sqlite3` — synchronous, zero-config, one file in
`DATA_DIR`. No ORM: five tables don't justify one, and hand-written SQL in
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

### `dashboard_users`

One row per Discord user who has ever signed into the dashboard: profile
(`username`, `global_name`, `avatar_url`), `is_admin`, `github_skipped`
(onboarding state), `first_login_at`/`last_login_at`. Populated on magic-link
redemption (`web/routes/auth.ts`) — see
[Dashboard accounts](/claudecord/guide/dashboard-accounts/) for how `is_admin`
gets decided. Never holds a token; those stay in `secrets.json`.

### `app_config`

Key/value for non-secret app state — the dashboard session-cookie secret and
the magic-link signing secret (both HMAC keys, generated once via
`getOrInit`), plus `migration_version`: unset means the auth-model upgrade
wizard (`src/migration.ts`, [Upgrading from the old auth
model](/claudecord/guide/migration/)) hasn't run yet on an install with
prior state; a fresh install gets it stamped immediately. **Never put
tokens here.**

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
