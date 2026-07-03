---
title: Talking to Claude
description: Mentions, threads, attachments and slash commands.
---

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
| `/help` | Cheat sheet of all of the above |
