---
title: GitHub integration
description: Give the bot a token so it can clone, push and open PRs on your repositories.
---

Configure a GitHub token and the bot can work directly with your
repositories from inside a Discord thread: clone a repo, read the code,
make changes, push a branch and open a pull request — all through the
`git` and `gh` command-line tools.

## Requirements

GitHub access only works in **[agentic mode](/claudecord/guide/access-control/)**,
because that is what grants Claude the `Bash` tool it needs to run `git` and
`gh`. Enable agentic mode per server (dashboard → Access control, or
`/config agentic true`) before the token has any effect.

The shipped Docker image ships with `git` and the `gh` CLI pre-installed. If
you run the bot outside Docker, make sure both are on the `PATH`.

## Configuring the token

Two equivalent ways, env var wins:

- **Dashboard** → Setup → *GitHub access*. The token is validated against the
  GitHub API and stored in `DATA_DIR/secrets.json` (mode `600`).
- **`GITHUB_TOKEN`** environment variable (`GH_TOKEN` is accepted as an
  alias). An env var always takes precedence over the stored token.

The token is treated exactly like the Claude and Discord credentials: never
written to the SQLite database, never logged. Inside an agentic run it is
exposed to the subprocess as `GH_TOKEN`/`GITHUB_TOKEN` (so `gh` is
authenticated) and wired into `git` for HTTPS operations against
`github.com`. It is **not** exposed to chat-only threads.

## Which permissions to grant

A **fine-grained personal access token**
([github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta))
scoped to only the repositories you want the bot to touch is strongly
recommended. Grant these repository permissions:

| Permission | Level | Why |
| --- | --- | --- |
| **Metadata** | Read | Mandatory — auto-selected by GitHub |
| **Contents** | Read, or Read & write | Clone/read code; write is needed to push commits and branches |
| **Pull requests** | Read & write | Open, update and comment on pull requests |
| **Issues** | Read & write | Optional — read and triage issues |

A **classic PAT** with the `repo` scope also works, but it grants access to
*every* repository the account can see — prefer a fine-grained token scoped
to just what you need.

The token only ever has the access **you** grant it. The bot can do nothing
on GitHub that the token itself couldn't.

## Per-user GitHub (multi-user servers)

On a shared server, a single token means *everyone* acts in one person's
GitHub namespace. Instead, let each role-gated member connect their **own**
GitHub account, so agentic runs act as whoever started them — the same
account-linking model as Claude in Slack.

This uses a **GitHub App** and the OAuth **Device Flow**, so it needs no
public callback URL (the dashboard normally binds to localhost).

### One-time operator setup

1. Register a GitHub App (Settings → Developer settings → **GitHub Apps** →
   New). Under *Identifying and authorizing users*, check **Enable Device
   Flow**. Give it the repository permissions you want linked users to be able
   to use (Contents, Pull requests, etc. — same table as above).
2. Copy the **Client ID** and generate a **Client secret**.
3. Add them in the dashboard (Setup → *Per-user GitHub*) or via
   `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` (env wins). Tokens and
   secrets live in `DATA_DIR/secrets.json` (mode `600`), never in SQLite or logs.
4. Choose which roles may link, per server: dashboard → Access control →
   *GitHub roles*, or `/config allow-github-role @role`.

### Linking (each user)

In a server, run **`/link-github link`**. The bot replies (only visible to
you) with a short code and a URL; open it, enter the code, approve, and the
message updates to confirm. `/link-github status` shows your link and
`/link-github unlink` disconnects it (revoking the token best-effort).

### How the token is chosen per turn

For each agentic message, the **message author's** token is used:

- **A GitHub role gate is set** on the server → only members with a GitHub
  role get a token, and strictly their own. The shared `GITHUB_TOKEN` is
  **never** used as a fallback there. A gated-in member who hasn't linked
  simply gets no GitHub access until they run `/link-github`.
- **No gate set** → the author's linked token if they have one, otherwise the
  shared `GITHUB_TOKEN` (the original single-user behaviour, unchanged).

User tokens are refreshed automatically before they expire.

## Security

The same warning as agentic mode applies, amplified: anyone allowed to talk
to the bot can indirectly drive `git`/`gh` with this token. Scope the token
tightly (specific repos, least privilege), enable agentic mode only where you
trust every allowed role, and revoke the token if that trust is ever broken.
With per-user linking, each member's access is bounded by what *their* own
GitHub account and the App's permissions allow.

To remove GitHub access, clear the field in the dashboard (submit an empty
token) or unset `GITHUB_TOKEN`, then revoke the token on GitHub. To remove a
linked user, unlink them in the dashboard (Setup → *Per-user GitHub*) or have
them run `/link-github unlink`.
