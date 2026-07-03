---
title: Deployment
description: Docker Compose (recommended), bare Node, volumes and updating.
---

## Docker Compose (recommended)

```bash
git clone https://github.com/t11z/claudecord.git
cd claudecord
docker compose up -d
```

Then finish setup in the dashboard at `http://localhost:3000`. Alternatively,
skip the wizard by putting your tokens in a `.env` file first (see
`.env.example`) — Compose picks it up automatically.

### Volumes — do not skip this

The compose file mounts two volumes. Both matter:

| Volume | Contains | If you lose it |
| --- | --- | --- |
| `claudecord-data` → `/data` | SQLite DB, secrets, per-thread workspaces | all config & thread mappings gone |
| `claudecord-claude` → `/home/bot/.claude` | Claude Code's session storage | **every conversation forgets its history on restart** |

Claude Code persists conversation state on disk, keyed by each session's
working directory. That's why `~/.claude` needs a volume and why the bot
never changes a thread's workspace path.

### Exposing the dashboard

By default the dashboard is only reachable from the machine itself
(`127.0.0.1:3000`). To reach it from elsewhere, set both:

```bash
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PASSWORD=something-long-and-random
```

The bot **refuses to start** with a non-localhost host and no password.
Put a reverse proxy with TLS in front for anything beyond your LAN.

## Bare Node

```bash
npm install
npm run build
cp .env.example .env   # fill in tokens
npm start
```

Node ≥ 20 required. Use a process manager (systemd, pm2) for anything
long-lived, and back up `./data` plus `~/.claude`.

## Updating

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically on startup.

## Host sizing

Each concurrent Claude run spawns a Claude Code subprocess (roughly a small
Node process each). The default cap of 4 concurrent runs is comfortable on
1 vCPU / 1 GB. Raise `MAX_CONCURRENT_RUNS` only with the RAM to match.
