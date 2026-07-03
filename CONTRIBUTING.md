# Contributing to claudecord

Thanks for your interest — contributions of every size are welcome, from typo
fixes to new features. This guide gets you from clone to green PR.

## Development setup

Prerequisites: **Node.js ≥ 20** and npm.

```bash
git clone https://github.com/t11z/claudecord.git
cd claudecord
npm install
cp .env.example .env   # fill in at least DISCORD_BOT_TOKEN + a Claude credential
npm run dev            # starts the bot with tsx watch
```

For the dashboard frontend with hot reload, run in a second terminal:

```bash
npm run dev:dashboard  # Vite dev server, proxies /api to the bot
```

You don't need real tokens to work on most modules — the test suite mocks the
Claude Agent SDK and Discord entirely.

## Project map

| Path | What lives there |
| --- | --- |
| `packages/bot/src/claude/` | The Claude Agent SDK integration — `runner.ts` is the heart of the project |
| `packages/bot/src/discord/` | discord.js client, mention/thread handlers, slash commands, message splitting, pseudo-streaming |
| `packages/bot/src/db/` | SQLite (better-sqlite3), migrations, repositories |
| `packages/bot/src/queue/` | Per-guild serial queue + global concurrency semaphore |
| `packages/bot/src/web/` | Hono server: dashboard API + static frontend |
| `packages/dashboard/` | Preact + Vite admin dashboard |
| `docs/` | Astro Starlight documentation site (GitHub Pages) |

A deeper tour lives in the
[Maintainer Guide](https://t11z.github.io/claudecord/maintainer/architecture/).

## Checks

Run these before opening a PR — CI runs exactly the same commands:

```bash
npm run lint        # Biome (lint + format check)
npm run typecheck   # tsc --noEmit for bot + dashboard
npm test            # vitest unit tests
npm run build       # dashboard + bot production build
```

`npm run lint:fix` auto-fixes most style issues.

## Tests

- Unit tests live next to a `tests/` directory in `packages/bot`.
- Pure modules (`splitter`, `queue`, `access-control`, `errors`) are tested
  directly; database repositories run against in-memory SQLite.
- The Agent SDK is never called in tests — `claude/runner.ts` is mocked behind
  its interface. If you change `runner.ts`, describe your manual test in the PR.

## Commit & PR conventions

- Small, focused PRs review faster than big ones.
- Commit messages: imperative mood, e.g. `Add fence-aware splitting for embeds`.
  Conventional-commit prefixes (`feat:`, `fix:`) are welcome but not enforced.
- Fill in the PR template — especially the test plan.
- Update the docs in `docs/` when you change user-facing behaviour.

## Where to start

- Issues labeled [`good first issue`](https://github.com/t11z/claudecord/labels/good%20first%20issue)
  are scoped for newcomers and include pointers into the code.
- [`help wanted`](https://github.com/t11z/claudecord/labels/help%20wanted)
  issues are larger but self-contained.
- Not sure? Open a discussion or a draft PR early — we're happy to help you
  land it.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
