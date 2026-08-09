---
title: Dashboard
description: API surface, auth model and frontend structure.
---

## Backend

A [Hono](https://hono.dev) app inside the bot process (`src/web/`). It
serves the JSON API under `/api/*` and the built frontend from
`packages/bot/public/`.

### Auth model

No password anywhere — see
[Dashboard accounts](/claudecord/guide/dashboard-accounts/) for the
user-facing story. The implementation, module by module:

- `discord/commands/dashboard.ts` — `/dashboard` checks `isAllowed()` for
  the invoking guild, then mints a token via `web/magic-link.ts`
  (`MagicLinkIssuer`): an HMAC-signed, single-use, 5-minute-TTL claims blob
  (`{sub, username, globalName, avatarUrl, hasManageGuild}`). Single-use is
  enforced with an in-memory consumed-nonce set — losing it on restart is
  harmless given the TTL.
- `web/routes/auth.ts` — `GET /api/auth/link` consumes the token, decides
  `isAdmin` (`decideIsAdmin`: env override → sticky existing flag → claim
  on first login with Manage Guild), upserts `dashboard_users`, issues the
  session cookie, and 302s to `/` with `Referrer-Policy: no-referrer` so the
  spent token doesn't leak via the next page's referrer.
- `web/auth.ts` (`DashboardAuth`) — signs/verifies the session cookie
  (`{sub, isAdmin, exp}`), HMAC over `app_config`'s
  `dashboard_cookie_secret`, HttpOnly + `SameSite=Strict`, 30-day rolling
  TTL (re-issued on every authenticated request via `touch`).
- `web/middleware.ts` — three gates:
  - `requireUser()` — 401 if no session. Gates `/api/me/*` only.
  - `requireAdmin()` — 401 no session, 403 non-admin. Every route that
    existed before per-user accounts requires this.
  - `requireGuildManager(ctx)` — 401 no session; otherwise passes an admin
    through unconditionally, or does a single-member REST fetch
    (`guild.members.fetch(id)`, no privileged Guild Members intent needed —
    that's only for bulk/gateway member caching) to check Manage Guild on
    the guild named by the route's `:id` param. Gates
    `GET`/`PUT /api/guilds/:id/config` only.

  See `web/server.ts` (`buildApiApp`) for exactly where each gate is
  mounted: `authRoutes`, then `meRoutes`, then `guildConfigRoutes` are all
  registered *before* `app.use("/api/*", requireAdmin(...))`, so they're
  exempt from the blanket gate and rely on their own instead — route
  registration order is load-bearing for this, see the comment in
  `server.ts`.

`tests/web-route-gating.test.ts` asserts the blanket-admin set holds across
every pre-existing route by building the real app (`buildApiApp(ctx, false)`,
no port bound) and checking 401/403/pass-through for no-session, non-admin
and admin sessions respectively; `tests/me-routes.test.ts` and
`tests/require-guild-manager.test.ts` do the same for the other two gates.
This is what turns "someone forgot a gate" into a red CI run instead of a
review question.

### Endpoints

Unauthenticated:

| Method & path | Purpose |
| --- | --- |
| `GET /api/auth/link` | redeem a `/dashboard` magic link, issue the session cookie |
| `GET /api/auth/session` | current session's user + role, or `{user: null}` |
| `POST /api/auth/logout` | clear the session cookie |

Self-scoped (behind `requireUser()` — always the caller's own `sub`, never a path/body id):

| Method & path | Purpose |
| --- | --- |
| `GET /api/me` | profile, Claude/GitHub link status, onboarding-complete flag, mutual guilds |
| `POST`/`DELETE /api/me/claude` | link (validates via `checkClaudeAuth`) / unlink your own Claude token |
| `POST /api/me/github/device`, `POST /api/me/github/device/poll` | GitHub Device Flow, one step each — no server-side pending state, the `deviceCode` round-trips through the browser |
| `POST /api/me/github/skip` | mark GitHub onboarding skipped (remembered, not re-asked) |
| `DELETE /api/me/github` | unlink your own GitHub account (best-effort revoke) |
| `GET /api/me/usage?window=30` | your own usage totals only |

Guild-scoped (behind `requireGuildManager()` — admin, or Manage Guild on that specific guild):

| Method & path | Purpose |
| --- | --- |
| `GET/PUT /api/guilds/:id/config` | allowlists, agentic toggle, model, extra prompt (GET includes channel/role pickers) |

Admin-only (behind `requireAdmin()`):

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | connection state, linked-identity counts, queue, invite URL |
| `POST /api/setup/github-app` | store/clear the GitHub App used for `/link-github` |
| `GET /api/guilds` | the full guild list, instance-wide |
| `GET /api/github/identities`, `DELETE /api/github/identities/:id` | per-user GitHub links |
| `GET /api/claude/identities`, `DELETE .../:id`, `POST .../:id/check` | per-user Claude links |
| `GET /api/sessions` | thread↔session table with live running state |
| `DELETE /api/sessions/:threadId` | reset (drops the mapping, aborts if running) |
| `POST /api/sessions/:threadId/abort` | abort a running query |
| `GET /api/stats?window=30` | totals, daily series, top servers/users |

There is deliberately no bot-token setup endpoint — `DISCORD_BOT_TOKEN` only
ever comes from `.env`, since reaching the dashboard at all requires the bot
to already be online (see `getting-started.md`).

DTO types are defined once in `packages/bot/src/types.ts` (kept free of
runtime imports) and imported **type-only** by the frontend — one source of
truth, zero runtime coupling.

## Frontend

Preact + Vite in `packages/dashboard/`, building into `packages/bot/public/`.
Deliberately boring:

- No router library — a 30-line hash router in `main.tsx`.
- No state library — `useState` + polling (`/api/status` every 5 s).
- No chart library — an inline SVG `Sparkline` component.
- Theme in `src/theme.css`: CSS custom properties, serif headings, light
  mode leans Anthropic (cream/terracotta), dark mode leans Discord
  (ink/blurple) via `prefers-color-scheme`.

`main.tsx` branches on `GET /api/auth/session` into `SignedOut` (no
session), `MemberApp` (session, not admin), or `AdminApp` (session, admin).
`MemberApp` further branches on `GET /api/me`'s `onboardingComplete`:
`Welcome.tsx` (the three-step wizard) while incomplete, `Account.tsx`
(self-service link status + usage) once done. `AdminApp` is the unchanged
five-page router (Overview/Setup/Access/Sessions/Usage) from before per-user
accounts existed.

### Dev workflow

```bash
npm run dev            # bot + API on :3000
npm run dev:dashboard  # Vite on :5173, proxies /api → :3000
```

The production build (`npm run build`) outputs static files the bot serves
itself — no separate frontend deployment exists.
