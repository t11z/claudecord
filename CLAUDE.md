# claudecord

Self-hosted @claude for Discord. Auth is a Claude Code OAuth token; the plain Anthropic Messages
API rejects that token, so driving the Claude Code CLI through the Agent SDK is the premise of
this project, not an implementation detail.

<!-- Audit cycle: cut back to essentials 2026-08. Re-audit by 2027-02 — delete every line below,
     run real tasks against the empty file, and restore only what demonstrably fails without it.
     Redundancy is not the test; observed failure is. Anything that only matters inside one part
     of the tree belongs in .claude/rules/ with paths: frontmatter, not here. -->

- A thread's `cwd` is immutable once written. Claude Code keys session storage by cwd hash —
  changing it breaks `resume` silently, with no failing test and no error.
- Tokens live in env vars or `DATA_DIR/secrets.json`. Never in SQLite, never in logs.
- Before calling anything done: `npm run lint && npm run typecheck && npm test`.
