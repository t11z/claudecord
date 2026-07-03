---
title: GitHub integration
description: Give the bot a token so it can clone, push and open PRs on your repositories.
---

Configure a GitHub token and the bot can work directly with your
repositories from inside a Discord thread: clone a repo, read the code,
make changes, push a branch and open a pull request — all through the
`git` and `gh` command-line tools.

## Requirements

GitHub access only works in **[agentic mode](/claude-discord/guide/access-control/)**,
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

## Security

The same warning as agentic mode applies, amplified: anyone allowed to talk
to the bot can indirectly drive `git`/`gh` with this token. Scope the token
tightly (specific repos, least privilege), enable agentic mode only where you
trust every allowed role, and revoke the token if that trust is ever broken.

To remove GitHub access, clear the field in the dashboard (submit an empty
token) or unset `GITHUB_TOKEN`, then revoke the token on GitHub.
