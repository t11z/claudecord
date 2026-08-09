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

## 1. Create a Discord application and put the token in `.env`

At [discord.com/developers/applications](https://discord.com/developers/applications),
create an application, add a **Bot**, and on the Bot page enable the
**Message Content Intent** (required for @mentions — the single most common
setup mistake is forgetting this one). See
[Discord app setup](/claudecord/guide/discord-app-setup/) for screenshots.

There is no dashboard form for this — the dashboard itself needs the bot
online to be reachable at all (see step 3), so the bot token has to reach
the instance through `.env` from the start:

```bash
git clone https://github.com/t11z/claudecord.git
cd claudecord
cp .env.example .env
```

Edit `.env` and set `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` from
the Developer Portal's Bot and General Information pages.

## 2. Start the bot and invite it to a server

```bash
docker compose up -d
```

Build the invite link yourself — it only needs the application ID, no
running dashboard required — and open it in a browser:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot%20applications.commands&permissions=397552861248
```

Prefer bare Node? See [Deployment](/claudecord/guide/deployment/) for the
non-Docker path.

## 3. Sign in and link your own Claude subscription

In the server you just invited the bot to, run:

```
/dashboard
```

The bot replies (visible only to you) with a one-time sign-in link. Open
it — you're now signed in, and as the first person to sign in with **Manage
Guild** on that server, you're the instance's first admin automatically (see
[Dashboard accounts](/claudecord/guide/dashboard-accounts/) for how that
decision is made, and for `DASHBOARD_ADMIN_IDS` if you'd rather set it
explicitly).

Since you haven't linked a Claude subscription yet, you land straight in a
short wizard. On any machine with [Claude Code](https://code.claude.com/)
installed, generate a token:

```bash
claude setup-token
```

This walks you through a browser login and prints a long-lived token
(`sk-ant-oat01-…`), valid for about a year. Paste it into the wizard — the
bot validates it with a real (tiny) query before storing it. GitHub linking
is the next step and skippable; skip it for now unless you're setting up
agentic mode.

:::note
The OAuth token only works through Claude Code itself, which is exactly how
claudecord talks to Claude (via the Claude Agent SDK). It will **not**
work with the plain Anthropic REST API — that's not a bug, it's how
subscription auth works.
:::

## 4. Everyone else links their own subscription

Every other member who wants the bot to answer them does the same thing —
`/dashboard` in Discord, then the wizard — or, without ever opening a
browser, runs `/link-claude link` directly and pastes the token into the
modal that pops up. Either path validates the same way and stores to the
same place; nobody else's subscription is ever touched by someone else
linking theirs.

## 5. Say hello

In any text channel the bot can see:

> **@YourBot** explain the difference between a thread and a forum post

The bot reacts with 👀, opens a thread, and streams its answer there. Keep
typing in the thread — no mention needed, it remembers everything. If you
see a 🔑 reaction instead, you (or whoever spoke) haven't run `/link-claude`
yet.

## Next steps

- [Configuration](/claudecord/guide/configuration/) — env vars, models, limits
- [Dashboard accounts](/claudecord/guide/dashboard-accounts/) — magic-link login, admin vs. member
- [Access control](/claudecord/guide/access-control/) — who may talk to the bot, and the agentic mode switch
- [Troubleshooting](/claudecord/guide/troubleshooting/) — when something doesn't work
