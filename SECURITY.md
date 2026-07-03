# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
[GitHub private vulnerability reporting](https://github.com/t11z/claudecord/security/advisories/new)
so we can fix the issue before it is disclosed.

You can expect an initial response within a week. Please include reproduction
steps and the deployment method (Docker or bare npm).

## Threat model — read this before enabling agentic mode

claudecord has two capability modes:

- **Chat mode (default):** Claude can only converse and use web search/fetch.
  Prompt injection by Discord users can at worst produce bad text.
- **Agentic mode (opt-in, per guild):** Claude additionally gets file and shell
  tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`) with
  `bypassPermissions` inside a per-thread working directory.

In agentic mode, **anyone allowed to talk to the bot can indirectly execute
commands on the host**. Prompt injection is not a theoretical risk: a crafted
message (or a file the bot is asked to read) can instruct Claude to run
arbitrary shell commands, including reading environment variables such as your
`CLAUDE_CODE_OAUTH_TOKEN`.

Mitigations built into the project:

- Agentic mode is **off by default** and can only be enabled by server admins
  (Manage Guild permission) or via the dashboard.
- Each thread gets an isolated working directory under `DATA_DIR/workspaces/`.
- The documented deployment runs the bot in a **Docker container** as a
  non-root user, which bounds the blast radius to the container.

Operator responsibilities:

- Only enable agentic mode on servers where you trust every allowed role.
- Run the bot in Docker (or an equivalent sandbox) when agentic mode is on.
- Treat the OAuth token as compromised if an untrusted party had agentic
  access; revoke and re-issue with `claude setup-token`.

## Secrets handling

- Tokens are read from environment variables and never written to the
  database or logs.
- The dashboard refuses to start on a non-localhost interface unless
  `DASHBOARD_PASSWORD` is set.
