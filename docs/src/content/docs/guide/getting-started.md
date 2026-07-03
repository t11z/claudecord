---
title: Getting started
description: From zero to a talking Claude bot in about five minutes.
---

claudecord is a **self-hosted** Discord bot. You run it — on a home
server, a VPS, or your laptop — and it talks to Claude using *your*
credentials. Nothing is shared with anyone else.

## Prerequisites

1. **A Claude subscription** (Pro, Max, Team or Enterprise) *or* an Anthropic
   API key. The subscription route is what this project is built around:
   flat-rate, no surprise bills.
2. **A Discord account** to create the bot application (free).
3. **Docker** (recommended) or Node.js ≥ 20.

## 1. Get a Claude Code OAuth token

On any machine with [Claude Code](https://code.claude.com/) installed:

```bash
claude setup-token
```

This walks you through a browser login and prints a long-lived token
(`sk-ant-oat01-…`). Copy it — you'll paste it into the setup wizard in a
minute. The token is valid for about a year.

:::note
The OAuth token only works through Claude Code itself, which is exactly how
claudecord talks to Claude (via the Claude Agent SDK). It will **not**
work with the plain Anthropic REST API — that's not a bug, it's how
subscription auth works.
:::

## 2. Start the bot

```bash
git clone https://github.com/t11z/claudecord.git
cd claudecord
docker compose up -d
```

That's it for the server side. The bot starts in "setup mode" and serves its
dashboard on [http://localhost:3000](http://localhost:3000).

Prefer bare Node? See [Deployment](/claudecord/guide/deployment/) for the
non-Docker path.

## 3. Run the setup wizard

Open [http://localhost:3000](http://localhost:3000) and follow the three
steps:

1. **Claude credential** — paste the OAuth token. The wizard validates it by
   running a real (tiny) query.
2. **Discord bot** — paste your bot token and application ID. Don't have one
   yet? The wizard links you through it, or read
   [Discord app setup](/claudecord/guide/discord-app-setup/) — the one
   thing you must not miss is enabling the **Message Content Intent**.
3. **Invite** — the wizard generates an invite link with exactly the
   permissions the bot needs.

## 4. Say hello

In any text channel the bot can see:

> **@YourBot** explain the difference between a thread and a forum post

The bot reacts with 👀, opens a thread, and streams its answer there. Keep
typing in the thread — no mention needed, it remembers everything.

## Next steps

- [Configuration](/claudecord/guide/configuration/) — env vars, models, limits
- [Access control](/claudecord/guide/access-control/) — who may talk to the bot, and the agentic mode switch
- [Troubleshooting](/claudecord/guide/troubleshooting/) — when something doesn't work
