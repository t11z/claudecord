---
title: GitHub integration
description: Let members link their own GitHub account so the bot can clone, push and open PRs as them.
---

claudecord has no shared, instance-wide GitHub token. GitHub access is
strictly **per-user**: each member links their own account, and agentic runs
they start clone, read, push and open pull requests as *them* — never as
anyone else, and never as some shared bot identity.

## Requirements

GitHub access only works in **[agentic mode](/claudecord/guide/access-control/)**,
because that is what grants Claude the `Bash` tool it needs to run `git` and
`gh`. Enable agentic mode per server (dashboard → Access control, or
`/config agentic true`) — linking has no effect until then.

The shipped Docker image ships with `git` and the `gh` CLI pre-installed. If
you run the bot outside Docker, make sure both are on the `PATH`.

A linked user's token is exposed to their own agentic run's subprocess as
`GH_TOKEN`/`GITHUB_TOKEN` (so `gh` is authenticated) and wired into `git` for
HTTPS operations against `github.com`. It is **not** exposed to chat-only
threads, and never to another user's run.

## One-time operator setup

Linking uses a **GitHub App** and the OAuth **Device Flow**, so it needs no
public callback URL (the dashboard normally binds to localhost).

1. Register a GitHub App (Settings → Developer settings → **GitHub Apps** →
   New). Under *Identifying and authorizing users*, check **Enable Device
   Flow**. Grant it these repository permissions — every user who links will
   be able to use exactly this set, scoped to whichever repos *they* can
   already access:

   | Permission | Level | Why |
   | --- | --- | --- |
   | **Metadata** | Read | Mandatory — auto-selected by GitHub |
   | **Contents** | Read, or Read & write | Clone/read code; write is needed to push commits and branches |
   | **Pull requests** | Read & write | Open, update and comment on pull requests |
   | **Issues** | Read & write | Optional — read and triage issues |

2. Copy the **Client ID** and generate a **Client secret**.
3. Add them in the dashboard (Setup → *Per-user GitHub access*) or via
   `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` (env wins). Secrets
   live in `DATA_DIR/secrets.json` (mode `600`), never in SQLite or logs.
4. Optionally gate who may link, per server: dashboard → Access control →
   *GitHub roles*, or `/config allow-github-role @role`. Empty = everyone may
   link.

## Linking (each user)

In a server, run **`/link-github link`**. The bot replies (only visible to
you) with a short code and a URL; open it, enter the code, approve, and the
message updates to confirm. `/link-github status` shows your link and
`/link-github unlink` disconnects it (revoking the token best-effort).

For each agentic message, the **message author's own** token is used — never
anyone else's, and never a shared fallback, because there isn't one. A member
who hasn't linked simply gets no GitHub access until they run `/link-github`.
User tokens are refreshed automatically before they expire.

## Security

The same warning as agentic mode applies, amplified: a member who links
grants the bot indirect `git`/`gh` access as *them* for the lifetime of the
link. Scope the GitHub App's permissions tightly, enable agentic mode only
where you trust every allowed role, and each user should unlink
(`/link-github unlink`) if they ever suspect that trust was broken — this
revokes their token best-effort and removes it from `secrets.json`.

To remove a linked user from the operator side, unlink them in the dashboard
(Setup → *Per-user GitHub access*).
