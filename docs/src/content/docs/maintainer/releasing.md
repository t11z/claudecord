---
title: Releasing
description: Versioning, tagging and what to check before cutting a release.
---

## Versioning

Semantic-ish versioning with a `0.x` honesty policy: breaking config or
database changes bump the minor; everything else is a patch. The version
lives in the root `package.json` and the workspace packages (keep them in
sync).

## Release checklist

1. `npm run lint && npm run typecheck && npm test && npm run build` — green.
2. **Real-token smoke test** (the one thing CI can't do):
   - start the bot with a `CLAUDE_CODE_OAUTH_TOKEN`,
   - mention it → thread is created, answer streams in,
   - reply in the thread → context is remembered (resume works),
   - `/reset`, `/usage`, `/help` respond,
   - dashboard loads, sessions table shows the thread.
3. `docker build .` succeeds and the container starts in setup mode without
   env vars.
4. Update `CHANGELOG` section in the GitHub release notes (there is no
   checked-in changelog file — release notes are the changelog).
5. Tag: `git tag v0.x.y && git push --tags`. This triggers the release
   workflow (see below); create the GitHub release once it's green.

## Docs deployment

The docs site auto-deploys to GitHub Pages via `.github/workflows/docs.yml`
on every push to `main` touching `docs/**`. There is no versioned docs
snapshot — docs describe `main`. Call out not-yet-released behavior with a
Starlight `:::note` when necessary.

## Docker image publishing

Pushing a tag matching `v*.*.*` (optionally with a `-rc.1`-style suffix)
triggers `.github/workflows/release.yml`, which builds a **multi-arch image
(`linux/amd64` + `linux/arm64`)** via Buildx/QEMU and pushes it to
[GHCR](https://github.com/t11z/claudecord/pkgs/container/claudecord)
as `ghcr.io/t11z/claudecord`.

Tags produced from `v1.2.3`:

| Tag | When |
| --- | --- |
| `1.2.3` | always |
| `1.2` | always |
| `1` | stable releases only (no `-` suffix) |
| `latest` | stable releases only |

Pre-releases (e.g. `v1.2.3-rc.1`) are published under their exact version tag
only — they never move `latest`. Since the workflow also accepts
`workflow_dispatch`, you can trigger a one-off build from any commit (with an
optional extra tag) without cutting a real release — handy for testing the
Dockerfile itself.
