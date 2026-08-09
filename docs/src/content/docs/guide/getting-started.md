---
title: Getting started
description: From zero to a talking Claude bot in about five minutes.
---

claudecord is a **self-hosted** Discord bot. You run the infrastructure — on
a home server, a VPS, or your laptop. There is no shared, instance-wide
Claude credential: every member who talks to the bot links **their own**
Claude subscription, and every run is billed to them.

## Prerequisites

1. **Docker** (recommended) or Node.js ≥ 20, to run the bot itself.
2. **A Discord account** to create the bot application (free).
3. Each person who will talk to the bot needs **their own Claude
   subscription** (Pro, Max, Team or Enterprise) to generate a Claude Code
   OAuth token. The subscription route is what this project is built around:
   flat-rate, no surprise bills, and no shared quota.

## 1. Start the bot

```bash
git clone https://github.com/t11z/claudecord.git
cd claudecord
docker compose up -d
```

That's it for the server side. The bot starts in "setup mode" and serves its
dashboard on [http://localhost:3000](http://localhost:3000).

Prefer bare Node? See [Deployment](/claudecord/guide/deployment/) for the
non-Docker path.

## 2. Run the setup wizard

Open [http://localhost:3000](http://localhost:3000) and follow the steps:

1. **Discord bot** — paste your bot token and application ID. Don't have one
   yet? The wizard links you through it, or read
   [Discord app setup](/claudecord/guide/discord-app-setup/) — the one
   thing you must not miss is enabling the **Message Content Intent**.
2. **Invite** — the wizard generates an invite link with exactly the
   permissions the bot needs.

There's a *Claude subscriptions* card too, but it's read-only — it just lists
who has linked so far. Linking itself always happens in Discord (next step).

## 3. Link your own Claude subscription

Invite the bot to a server, then in Discord run:

```
/link-claude link
```

A modal pops up asking for a token. On any machine with
[Claude Code](https://code.claude.com/) installed, generate one:

```bash
claude setup-token
```

This walks you through a browser login and prints a long-lived token
(`sk-ant-oat01-…`), valid for about a year. Paste it into the modal — it
never appears in the channel — and the bot validates it with a real (tiny)
query before storing it.

:::note
The OAuth token only works through Claude Code itself, which is exactly how
claudecord talks to Claude (via the Claude Agent SDK). It will **not**
work with the plain Anthropic REST API — that's not a bug, it's how
subscription auth works.
:::

Every other member who wants the bot to answer them runs the same
`/link-claude link` with their own token. Nobody else's subscription is ever
touched.

## 4. Say hello

In any text channel the bot can see:

> **@YourBot** explain the difference between a thread and a forum post

The bot reacts with 👀, opens a thread, and streams its answer there. Keep
typing in the thread — no mention needed, it remembers everything. If you
see a 🔑 reaction instead, you (or whoever spoke) haven't run `/link-claude`
yet.

## Next steps

- [Configuration](/claudecord/guide/configuration/) — env vars, models, limits
- [Access control](/claudecord/guide/access-control/) — who may talk to the bot, and the agentic mode switch
- [Troubleshooting](/claudecord/guide/troubleshooting/) — when something doesn't work
