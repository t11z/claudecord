---
title: Dashboard accounts
description: Magic-link sign-in, the two roles, and how the first admin is decided.
---

The dashboard has no password. The only way in is a one-time link Discord
sends you — there's nothing to configure, remember or leak besides your
Discord account itself.

## Signing in

Run `/dashboard` in any server the bot is in and you're allowed to talk to
it. The bot replies — visible only to you — with a link:

```
http://your-host:3000/api/auth/link?token=...
```

Open it within 5 minutes and it works exactly once. You'll see a "Signing you
in…" page flash past — that's a brief interstitial that submits the link for
you (a `<noscript>` button covers browsers without JS) — and it lands you on
the dashboard. A second visit (or someone else opening a link they found in
your chat history) fails — the link is already spent. Don't share it; anyone
who opens it signs in as you.

Upgrading an install that predates this model? The first admin to sign in
gets a one-time wizard for whatever the old password/shared-token setup left
behind — see [Upgrading from the old auth
model](/claudecord/guide/migration/).

The session itself is a signed, `HttpOnly`, `SameSite=Strict` cookie — also
`Secure` when the dashboard is served over https — good for 30 days and
renewed on every request while you're active.

## The two roles

Every signed-in account is one of:

- **Admin** — everything the dashboard can show: instance status, every
  linked identity, session management, usage stats, and every server's
  config.
- **Member** — a self-service view of just your own account: link or unlink
  your Claude subscription and GitHub account from the browser, see your
  own usage.

There's no in-between and no per-page permission matrix for the
instance-wide pages: Overview, Setup, Sessions and Usage all manage the
whole instance or list every user's data, so all of them require admin. The
one exception is per-server config — see *Guild-scoped access* below.

### First sign-in: the onboarding wizard

The first time you sign in, before you've linked anything, you land in a
short wizard instead of your account page:

1. **Discord** — just a confirmation; the login already did the coupling.
   Shows which servers you share with the bot.
2. **Claude subscription** — paste a token from `claude setup-token`.
   Functionally the same link `/link-claude link` makes in Discord, just
   easier to paste into from the terminal that printed it.
3. **GitHub (skippable)** — the same OAuth Device Flow `/link-github` uses,
   just walked through in the browser. Skipping is remembered, so you won't
   be asked again — link later from your account page whenever you want.
   If GitHub linking can't work for you — no GitHub App configured on this
   instance, or a `allow-github-role` gate you don't satisfy — the wizard says
   so instead of offering a button that would fail.

Both paths are equal: link in Discord or in the browser, whichever suits. A
small diagram shows the result — your Discord account, with a branch to Claude
and a branch to GitHub. Branches you haven't linked are dashed and carry the
command that would link them.

Once Claude is linked and GitHub is either linked or skipped, you land on
your **account page** on every future sign-in instead: your link status,
buttons to unlink or replace either token, and your own usage over the last
30 days. Nothing there is admin-visible to anyone but you.

Linking is symmetric with Discord either way — `/link-claude` and
`/link-github` in Discord always work too, whether or not you've ever
opened the dashboard.

## Guild-scoped access

Per-server settings (`GET`/`PUT /api/guilds/:id/config` — allowlists, the
agentic-mode switch, model override) aren't gated on being a dashboard
admin. They're gated on holding **Manage Guild** on that specific Discord
server — the same authority `/config` already uses. A server owner can
manage their own server's settings without being promoted to instance
admin; a dashboard admin can always reach any server's settings too.

## How the first admin is decided

On every sign-in, in order:

1. **`DASHBOARD_ADMIN_IDS`** (a comma-separated list of Discord user IDs in
   `.env`), if set, is authoritative — anyone listed is always admin, and
   setting this disables the automatic claim below for everyone else. This
   is the recommended way to grant admin on anything beyond a personal
   server.
2. **An existing admin flag is sticky.** Once you're an admin, signing in
   again without Manage Guild doesn't demote you — revoking admin is a
   deliberate dashboard action, not a side effect of a later login.
3. **Claim on first login.** If nobody is an admin yet and
   `DASHBOARD_ADMIN_IDS` is unset, whoever runs `/dashboard` while holding
   **Manage Guild** on that server becomes the first admin. This only fires
   once, while the admin set is genuinely empty — it's how a fresh install
   bootstraps itself without a password to type anywhere.

## Signing out

Click **Sign out** in the sidebar, or `POST /api/auth/logout`. There's
nothing else to rotate — if you're worried a link leaked, it's already
single-use and expired within 5 minutes either way.
