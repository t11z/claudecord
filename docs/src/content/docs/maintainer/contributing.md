---
title: Contributing
description: Dev setup, testing philosophy and how to find something to work on.
---

The short version lives in
[CONTRIBUTING.md](https://github.com/t11z/claudecord/blob/main/CONTRIBUTING.md);
this page adds the maintainer-level context.

## Dev setup

```bash
npm install
cp .env.example .env    # tokens optional for most work
npm run dev             # bot (tsx watch)
npm run dev:dashboard   # optional: dashboard with HMR
```

Everything CI runs:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Testing philosophy

- **Pure logic gets real tests.** `splitter`, `queue`, `access-control`,
  `errors` and the DB repos are fully unit-tested without any network.
- **Edges get interfaces.** The Agent SDK hides behind `ClaudeEngine`;
  Discord objects are only touched in thin handler/delivery code. If you
  find yourself wanting to mock discord.js deeply, move the logic into a
  pure module instead.
- **Error patterns need fixtures.** Anything added to `claude/errors.ts`
  must come with a fixture string in `tests/errors.test.ts` mirroring real
  CLI output.

Changes to `runner.ts` can't be covered by unit tests — describe your manual
smoke test in the PR (mention → thread → follow-up → resume works).

## Issue triage & labels

- `good first issue` — scoped, with pointers into the code. Add these
  generously when triaging; they're the project's front door.
- `help wanted` — bigger but self-contained.
- `security` — see [SECURITY.md](https://github.com/t11z/claudecord/blob/main/SECURITY.md);
  never discuss exploits in public issues.

## Ideas looking for owners

- Slash-command localization
- Forum-channel support (post = conversation)
- Idle-session pruning job (rows + workspace dirs + `~/.claude` sessions)
- A middle capability tier: file tools without `Bash`
- Per-user rate budgets
- Message-context menu ("Ask Claude about this message")

Open a discussion before starting anything architectural.
