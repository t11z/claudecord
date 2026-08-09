---
title: Troubleshooting
description: The errors you'll actually see, and what they mean.
---

## "Used disallowed intents" at startup

The **Message Content Intent** is not enabled. Developer Portal → your app →
**Bot** → Privileged Gateway Intents → enable **Message Content Intent**,
then restart the bot. This is the single most common setup mistake.

## The bot reacts with 🔑 and doesn't answer

You (or whoever sent the message) haven't linked a Claude subscription yet.
Run `/link-claude link` — see [Getting started](/claudecord/guide/getting-started/).
This is per-user; one member linking doesn't unlock the bot for anyone else.

## The bot ignores mentions

Checklist, in order:

1. Is the bot online (green dot)? If not, check the logs.
2. Does the channel/role allowlist exclude you? Check `/config show`.
3. Can the bot *read* the channel (View Channel permission)?
4. Was the message a *reply* to the bot rather than a mention? Only real
   @mentions trigger it outside threads.
5. If you got a 🔑 reaction instead of silence, see the section above — you
   need to `/link-claude` first.

## "Claude authentication failed" / `/link-claude` rejects your token

The token is invalid, expired or revoked.

- OAuth tokens from `claude setup-token` last about a year, but revoking
  Claude Code's access (or a password reset) invalidates them early.
- Fix: run `claude setup-token` again and `/link-claude link` with the fresh
  token (or `/link-claude unlink` first, then relink).
- There is **no automatic refresh** for headless OAuth tokens — this is a
  Claude Code platform property, not something the bot can work around.
- The dashboard's Claude subscriptions card has a *Re-check* button per user
  if you want to confirm a stored token still works without relinking.

## "Usage limit reached"

*Your own* subscription's usage window is exhausted (shared with your own
Claude Code sessions elsewhere) — this never affects other linked users. The
bot reports when the limit resets and pauses your queue briefly. Options:
wait, switch new conversations to a lighter model (`/model` → Haiku), or
restrict access more tightly.

## Conversations lose their memory after a restart (Docker)

The `~/.claude` volume is missing, so Claude Code's session files died with
the container. See [Deployment](/claudecord/guide/deployment/#volumes--do-not-skip-this).

## The dashboard shows "unauthorized" / won't load remotely

- Remote access requires `DASHBOARD_HOST=0.0.0.0` **and**
  `DASHBOARD_PASSWORD` set. Without the password the bot refuses to bind to
  a public interface at all.
- Cookies are `SameSite=Strict`; log in on the same origin you're browsing.

## Answers stop mid-sentence with ❌

Check the logs. Common causes: the run hit `maxTurns` (very tool-heavy
agentic tasks), the subprocess was killed (out of memory — lower
`MAX_CONCURRENT_RUNS`), or a transient API error (it will usually work on
retry).

## Where are the logs?

```bash
docker compose logs -f bot
```

Set `LOG_LEVEL=debug` for more detail. Logs never contain tokens.
