---
title: Configuration
description: Environment variables, credential precedence and the secrets store.
---

Everything is configured through environment variables (see `.env.example`
in the repository) plus per-server settings in the dashboard.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Claude Code OAuth token from `claude setup-token` (recommended) |
| `ANTHROPIC_API_KEY` | — | API-key fallback, used only when no OAuth token is set |
| `DISCORD_BOT_TOKEN` | — | Bot token from the Developer Portal |
| `DISCORD_APPLICATION_ID` | — | Application ID (slash commands + invite link) |
| `GITHUB_TOKEN` | — | Shared GitHub token for `git`/`gh` in agentic threads ([GitHub integration](/claudecord/guide/github-integration/)). `GH_TOKEN` is accepted as an alias |
| `GITHUB_APP_CLIENT_ID` | — | GitHub App client ID for per-user `/link-github` linking ([per-user GitHub](/claudecord/guide/github-integration/)) |
| `GITHUB_APP_CLIENT_SECRET` | — | GitHub App client secret (pairs with the client ID) |
| `DASHBOARD_HOST` | `127.0.0.1` | Dashboard bind address |
| `DASHBOARD_PORT` | `3000` | Dashboard port |
| `DASHBOARD_PASSWORD` | — | Required (min 8 chars) when `DASHBOARD_HOST` is not localhost |
| `CLAUDE_MODEL` | `claude-sonnet-5` | Default model for new conversations |
| `DATA_DIR` | `./data` | SQLite DB, secrets store, per-thread workspaces |
| `MAX_CONCURRENT_RUNS` | `4` | Global cap on parallel Claude runs (each is a subprocess) |
| `LOG_LEVEL` | `info` | `trace` … `error` |

## Credential precedence

1. Environment variables always win.
2. Tokens entered in the dashboard wizard are stored in
   `DATA_DIR/secrets.json` (file mode `600`) and used when the corresponding
   env var is absent.
3. OAuth token beats API key when both are present.

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

With OAuth auth, you share your subscription's limits (measured in 5-hour
windows) with your own Claude Code usage. The bot:

- runs at most one query per server at a time (plus the global cap),
- detects limit errors, tells the channel when the limit resets, and
- pauses the queue for a minute instead of hammering the API.

`/usage` in Discord and the dashboard's Usage page show recent consumption.
