---
title: Configuration
description: Environment variables, credential precedence and the secrets store.
---

Everything is configured through environment variables (see `.env.example`
in the repository) plus per-server settings in the dashboard.

## Environment variables

There is no Claude credential here — claudecord has no shared, instance-wide
one. Every user links their own with `/link-claude` (see
[Getting started](/claudecord/guide/getting-started/)).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | — | Bot token from the Developer Portal |
| `DISCORD_APPLICATION_ID` | — | Application ID (slash commands + invite link) |
| `GITHUB_APP_CLIENT_ID` | — | GitHub App client ID for per-user `/link-github` linking ([per-user GitHub](/claudecord/guide/github-integration/)) |
| `GITHUB_APP_CLIENT_SECRET` | — | GitHub App client secret (pairs with the client ID) |
| `DASHBOARD_HOST` | `127.0.0.1` | Dashboard bind address |
| `DASHBOARD_PORT` | `3000` | Dashboard port |
| `DASHBOARD_PUBLIC_URL` | `http://localhost:<port>` | Base URL baked into `/dashboard` sign-in links — set explicitly once the browser isn't on the same machine as the bot ([Dashboard accounts](/claudecord/guide/dashboard-accounts/)). A trailing slash is tolerated (stripped). An `https://` value also marks the session cookie `Secure`. |
| `DASHBOARD_ADMIN_IDS` | — | Comma-separated Discord user IDs that are always dashboard admins |
| `CLAUDE_MODEL` | `claude-sonnet-5` | Default model for new conversations |
| `DATA_DIR` | `./data` | SQLite DB, secrets store, per-thread workspaces |
| `MAX_CONCURRENT_RUNS` | `4` | Global cap on parallel Claude runs (each is a subprocess) |
| `LOG_LEVEL` | `info` | `trace` … `error` |

## Credential precedence

For the instance-wide variables above (Discord, GitHub App):

1. Environment variables always win.
2. Values entered in the dashboard wizard are stored in
   `DATA_DIR/secrets.json` (file mode `600`) and used when the corresponding
   env var is absent.

Per-user Claude and GitHub tokens (`/link-claude`, `/link-github`) live only
in `DATA_DIR/secrets.json` — there is no env-var form for them, since they
belong to individual Discord users, not the instance.

Tokens are **never** written to the SQLite database or to logs.

## Models

The default model is deliberately `claude-sonnet-5` — subscription limits
are measured in usage windows, and Sonnet stretches them much further than
Opus. Server admins can override per server with `/model` or in the
dashboard:

- **Sonnet 5** — fast, smart default
- **Opus 4.8** — most capable, burns limits faster
- **Haiku 4.5** — cheapest/fastest for simple Q&A

Existing threads keep the model they started with.

## Rate limits

Each user's runs draw on *their own* subscription's usage window (shared with
their own Claude Code sessions elsewhere) — never anyone else's. The bot:

- runs at most one query per user at a time (plus the global
  `MAX_CONCURRENT_RUNS` cap across everyone),
- detects limit errors, tells the channel when the limit resets, and
- pauses that user's queue for a minute instead of hammering the API — other
  users are unaffected.

`/usage` in Discord and the dashboard's Usage page show recent consumption.
