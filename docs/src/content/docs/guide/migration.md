---
title: Upgrading from the old auth model
description: The one-time wizard that walks an existing install through per-user credentials.
---

Older installs of claudecord had one shared, instance-wide Claude token
(`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`), one shared GitHub token
(`GITHUB_TOKEN`/`GH_TOKEN`), and a dashboard password. All three are gone —
every credential is per-user now (see *Access control & agentic mode* and
*Dashboard accounts*), and the dashboard is passwordless. Those env vars are
simply not read anymore.

A fresh install never sees any of this — there's nothing to migrate. An
existing install upgrading in place gets a **one-time wizard** the first
time an admin opens the dashboard, so nothing that used to work silently
starts failing without an explanation.

## What triggers it

The wizard shows up when the install has *prior state* — a linked identity,
a conversation thread, or a leftover key in `secrets.json` from the old
model — and hasn't completed the wizard yet. Both conditions are checked at
startup and again on every dashboard load; there is no way to see it twice
for the same install, and no way to see it at all on a genuinely fresh one.

## What it walks through

Every step is independently skippable and safe to run more than once:

1. **Shared Claude token.** If `secrets.json` still has the old
   `claudeOauthToken`, the wizard offers to verify it (the same one-turn
   check `/link-claude link` runs) and adopt it as *your own* Claude
   subscription — equivalent to pasting it into `/link-claude link`
   yourself. Verification failing leaves the key in place so you can retry;
   discarding it is always available instead.
2. **Shared API key.** An `anthropicApiKey` can't become a subscription
   OAuth token — claudecord only runs on Claude Code subscriptions now — so
   this step is discard-only, with an explanation.
3. **Shared GitHub token.** Same shape as step 1: verify against the GitHub
   API, adopt as your own `/link-github` identity, or discard.
4. **Dashboard password.** The old password hash, if still present, is no
   longer read by anything — this step just clears it out.
5. **Missing display profiles.** Anyone who linked Claude or GitHub straight
   from Discord but never opened the dashboard has no stored username or
   avatar yet. This step resolves them from the bot's live server member
   cache in one pass.

Finishing the wizard stamps `migration_version` in the database so it
never appears again — whether or not every step above was actually acted
on. Nothing here is mandatory; "discard everything and click Finish" is a
complete, valid path through it.

## Who sees it

Only dashboard admins. Every legacy key is instance-wide, so only an admin
should decide what happens to it; a non-admin signing in during this window
just sees their own account page as usual, onboarding into the current model
directly.
