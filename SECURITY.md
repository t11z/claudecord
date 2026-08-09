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
arbitrary shell commands, including reading environment variables such as the
acting user's own linked Claude/GitHub tokens.

claudecord has no shared, instance-wide Claude or GitHub credential — every
run is billed to, and acts as, the Discord user who sent the message (see
`/link-claude` and `/link-github`). This bounds the blast radius of a
successful prompt injection to that one user's own tokens: it can never
exfiltrate another user's subscription or GitHub account, and it can never
touch an operator-wide secret, because there isn't one.

A thread's Claude session is still **shared conversation state**: several
users can drive the same thread, and any file one of them has Claude write
into the thread's scratch workspace is readable by the next person who
speaks in it. Don't treat a thread's workspace as private to whoever started it.

Mitigations built into the project:

- Agentic mode is **off by default** and can only be enabled by server admins
  (Manage Guild permission) or via the dashboard.
- Each thread gets an isolated working directory under `DATA_DIR/workspaces/`.
- The documented deployment runs the bot in a **Docker container** as a
  non-root user, which bounds the blast radius to the container.

Operator responsibilities:

- Only enable agentic mode on servers where you trust every allowed role.
- Run the bot in Docker (or an equivalent sandbox) when agentic mode is on.

User responsibilities:

- Treat your own linked token as compromised if you used agentic mode on a
  server with untrusted members; `/link-claude unlink` (or `/link-github
  unlink`) and relink with a freshly issued token.

## Secrets handling

- Per-user Claude and GitHub tokens are entered through Discord (a modal for
  `/link-claude`, the OAuth Device Flow for `/link-github`) and stored in
  `DATA_DIR/secrets.json` (chmod 600) — never in the database, never in logs.
- The Discord bot token and, optionally, GitHub App credentials are the only
  instance-wide secrets, read from environment variables or the dashboard.

## Dashboard access

There is no dashboard password. Sign-in is a single-use, 5-minute link the
bot sends you (ephemerally, visible only to you) when you run `/dashboard`
in a server it's in — see
[Dashboard accounts](https://t11z.github.io/claudecord/guide/dashboard-accounts/)
for the full model, including how the first admin is decided. Practical
consequences:

- **Every route is authenticated by default** — a bare port scan or an open
  bind exposes nothing usable, unlike the old password-optional localhost
  default.
- **The sign-in link is a bearer token in a URL.** Treat it like a password
  for the ~5 minutes it's valid: don't paste it anywhere else, and it's
  already single-use so a second open (yours or anyone else's) fails safely.
- **`DASHBOARD_ADMIN_IDS`** is the recommended way to grant admin on
  anything beyond a personal server, since the automatic claim-on-first-login
  path grants admin to whoever gets there first while the admin set is empty.
