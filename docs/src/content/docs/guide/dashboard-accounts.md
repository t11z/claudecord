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

Open it within 5 minutes and it works exactly once: it signs you in and
redirects to the dashboard. A second click (or someone else opening a link
they found in your chat history) fails — the link is already spent. Don't
share it; anyone who opens it signs in as you.

The session itself is a signed, `HttpOnly`, `SameSite=Strict` cookie, good
for 30 days and renewed on every request while you're active.

## The two roles

Every signed-in account is one of:

- **Admin** — everything the dashboard can show: instance status, every
  linked identity, session management, usage stats, per-server config.
- **Member** — your own account only (still being built — see the note
  below).

There's no in-between and no per-page permission matrix: the pages that
existed before per-user accounts (Overview, Setup, Access control, Sessions,
Usage) all manage the whole instance or list every user's data, so all of
them require admin.

:::note
The self-service pages for members — link your own Claude/GitHub account
from the browser, see your own usage — are landing in a follow-up. Until
then, a member who signs in sees a placeholder; `/link-claude` and
`/link-github` in Discord remain the way to link.
:::

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
