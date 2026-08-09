---
title: Talking to Claude
description: Mentions, threads, attachments and slash commands.
---

## Before you start: link your subscription

claudecord has no shared Claude credential — the bot will only answer you
once you've run `/link-claude link` and pasted a token from
`claude setup-token` into the modal that pops up. See
[Getting started](/claudecord/guide/getting-started/) for the full walkthrough.

## Conversations

**Start:** mention the bot anywhere it's allowed:

> **@Claude** what's a good name for a cat that only knocks things off tables?

The bot reacts 👀, creates a thread named after your question, and answers
inside it. While it thinks you'll see the reply grow in place — Discord
doesn't support true streaming, so the bot edits its message every couple of
seconds.

**Continue:** just type in the thread. No mention needed; the whole thread is
one conversation and Claude remembers all of it (it survives bot restarts,
too).

**Stay quiet:** start a message with `//` inside a thread and the bot ignores
it — handy for talking to other humans mid-conversation.

**Forget:** `/reset` inside a thread wipes Claude's memory of it. The thread
keeps working, starting fresh.

## Attachments

Drop files into your message:

- **Text files** (`.md`, `.txt`, code files, JSON, CSV, … up to 256 KB) are
  passed to Claude inline.
- **Images** (PNG, JPEG, WebP, GIF up to 5 MB) are passed as images — ask
  questions about screenshots, diagrams, photos.
- Anything else is politely skipped (you'll see a note).

## Long answers

Replies longer than one Discord message are split — never inside a code
block. Very long answers arrive as a `response.md` attachment with a preview.

## Slash commands

| Command | What it does |
| --- | --- |
| `/ask prompt [private]` | One-shot question, no thread, no memory. `private: true` makes the answer visible only to you. |
| `/reset` | Forget the current thread's conversation |
| `/usage` | This server's usage over the last 30 days + queue state |
| `/model` | Pick the model for new conversations (admins) |
| `/config` | Allowlists, agentic mode, on/off (admins) |
| `/link-claude` | Connect your own Claude subscription — required before the bot will run for you |
| `/link-github` | Connect your own GitHub account for agentic runs (optional) |
| `/dashboard` | Get a one-time sign-in link for the web dashboard |
| `/help` | Cheat sheet of all of the above |
