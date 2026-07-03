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
  in agentic runs (see [per-user GitHub](/claudecord/guide/github-integration/)).
  Empty = per-user gating off. When set, the shared `GITHUB_TOKEN` is not used
  on that server.
- **Enabled** — a master switch per server.

Since every message to the bot consumes your subscription quota, restricting
to a `#claude` channel and/or a trusted role is a good default on busier
servers.

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
shell commands — including reading environment variables like your
`CLAUDE_CODE_OAUTH_TOKEN`. This is called prompt injection and no model is
immune to it.
:::

The project's mitigations:

- Agentic mode is **off by default** and per server.
- Only server admins (Manage Server) can enable it, via `/config agentic` or
  the dashboard.
- Each thread's working directory is isolated.
- The documented deployment runs the bot in a **Docker container as a
  non-root user**, so the blast radius is the container, not your host.

Your responsibilities:

- Only enable it where you trust **every** allowed role.
- Run the bot in Docker (or an equivalent sandbox) when it's enabled.
- If someone untrusted had agentic access, treat the Claude token as leaked:
  revoke it and run `claude setup-token` again.

Existing threads keep their mode; the toggle affects new threads.

## GitHub access

Agentic mode is also the prerequisite for the optional
[GitHub integration](/claudecord/guide/github-integration/): with a token
configured, agentic threads can clone, push and open pull requests on your
repositories via `git` and `gh`. Scope the token tightly and read that page's
security note before enabling it.

On shared servers, prefer **per-user GitHub**: register a GitHub App, gate it
with *GitHub roles*, and each member runs `/link-github` to act in their own
namespace instead of everyone sharing one token. See the
[GitHub integration](/claudecord/guide/github-integration/) page.
