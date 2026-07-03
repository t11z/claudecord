---
title: Discord app setup
description: Creating the Discord application, enabling the Message Content Intent, and inviting the bot.
---

You need a Discord *application* with a *bot user*. This takes two minutes
and is free.

## Create the application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**.
2. Give it a name — this is what people will @mention, so something like
   `Claude` works nicely.
3. On **General Information**, copy the **Application ID**. The setup wizard
   asks for it (it's used to register slash commands and build the invite
   link).

## Create the bot & token

1. Go to the **Bot** page.
2. Click **Reset Token** and copy the token. Treat it like a password — anyone
   with this token *is* your bot.

## Enable the Message Content Intent

Still on the **Bot** page, under **Privileged Gateway Intents**:

- Toggle **Message Content Intent** → ON.

:::caution[This step is not optional]
Without this intent, Discord doesn't deliver message text to the bot, and the
connection fails with `Used disallowed intents`. It's called "privileged" but
requires no approval below 100 servers — which is exactly the self-hosted use
case.
:::

The other privileged intents (Presence, Server Members) are **not** needed.

## Invite the bot

Use the invite link from the dashboard overview page — it requests exactly
these permissions:

| Permission | Why |
| --- | --- |
| View Channels, Read Message History | see your messages |
| Send Messages, Send Messages in Threads | answer |
| Create Public Threads | one thread per conversation |
| Embed Links, Attach Files | rich replies, `response.md` for long answers |
| Add Reactions | the 👀 / ✅ / ❌ lifecycle |

You need **Manage Server** permission on the target server to invite it.
