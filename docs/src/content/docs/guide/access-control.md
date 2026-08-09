---
title: Access control & agentic mode
description: Allowlists, and what enabling file/shell tools really means.
---

## Allowlists

Per server (dashboard → Access control, or `/config`):

- **Channels** — empty list = the bot answers everywhere it can read.
  Threads inherit their parent channel's status.
- **Roles** — empty list = everyone may talk to the bot. Otherwise a user
  needs at least one allowlisted role.
- **GitHub roles** — which roles may link and use their **own** GitHub account
  in agentic runs (see [GitHub integration](/claudecord/guide/github-integration/)).
  Empty = anyone may link.
- **Enabled** — a master switch per server.

Every message to the bot consumes the *sending user's own* Claude subscription
quota — never anyone else's. Restricting to a `#claude` channel and/or a
trusted role is still a good default on busier servers, mostly to keep the
signal-to-noise ratio sane.

## Agentic mode

By default Claude can **chat and search the web** — nothing else. Agentic
mode additionally grants file tools (`Read`, `Write`, `Edit`, `Glob`,
`Grep`) and **`Bash`** inside a per-thread scratch workspace under
`DATA_DIR/workspaces/<server>/<thread>`, with Claude Code's permission
prompts bypassed (nobody is there to click "allow").

That unlocks real work — "write a script and run it", "analyze this CSV",
"scaffold a project and zip it" — and real risk:

:::danger[Read this before flipping the switch]
In agentic mode, **anyone who may talk to the bot can indirectly execute
commands on the machine the bot runs on.** Not hypothetically: a crafted
message (or a file the bot is asked to summarize) can instruct Claude to run
shell commands — including reading environment variables like the acting
user's own linked Claude/GitHub tokens. This is called prompt injection and
no model is immune to it. Because claudecord has no shared, instance-wide
credential, a successful injection can only ever reach the tokens of the
Discord user who sent that message — never anyone else's.
:::

The project's mitigations:

- Agentic mode is **off by default** and per server.
- Only server admins (Manage Server) can enable it, via `/config agentic` or
  the dashboard.
- Each thread's working directory is isolated.
- The documented deployment runs the bot in a **Docker container as a
  non-root user**, so the blast radius is the container, not your host.

Your responsibilities as operator:

- Only enable it where you trust **every** allowed role.
- Run the bot in Docker (or an equivalent sandbox) when it's enabled.

Each user's responsibility: if you had agentic access on a server with
untrusted members, treat your own linked token as leaked — run
`/link-claude unlink`, generate a fresh one with `claude setup-token`, and
`/link-claude link` again.

Existing threads keep their mode; the toggle affects new threads.

## GitHub access

Agentic mode is also the prerequisite for the optional
[GitHub integration](/claudecord/guide/github-integration/): once configured
by an operator (a GitHub App, no shared token), each member runs
`/link-github` to connect their own account, and their agentic runs then
clone, push and open pull requests as *them*. Gate who may link with
*GitHub roles*, and read that page's security note before enabling it.
