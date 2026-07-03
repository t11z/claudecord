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
5. Tag: `git tag v0.x.y && git push --tags`, then create the GitHub release.

## Docs deployment

The docs site auto-deploys to GitHub Pages via `.github/workflows/docs.yml`
on every push to `main` touching `docs/**`. There is no versioned docs
snapshot — docs describe `main`. Call out not-yet-released behavior with a
Starlight `:::note` when necessary.

## Docker image publishing

CI currently builds the image as a check but does not push it. Publishing to
GHCR on tags is a wanted contribution — see the ideas list in
[Contributing](/claude-discord/maintainer/contributing/).
