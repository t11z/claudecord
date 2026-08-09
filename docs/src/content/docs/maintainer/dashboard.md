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
- `web/routes/auth.ts` — the link redeem is two steps, not one:
  - `GET /api/auth/link` verifies the token with `MagicLinkIssuer.peek()`
    (signature, expiry, not-yet-used) **without spending it**, and renders a
    tiny auto-submitting interstitial page. Side-effect-free: no role
    decision, no `dashboard_users` write, no cookie.
  - `POST /api/auth/link` — submitted by that interstitial — is the only
    place a link is ever spent: `consume()`, decide `isAdmin`
    (`decideIsAdmin`: env override → sticky existing flag → claim on first
    login with Manage Guild), upsert `dashboard_users`, issue the session
    cookie, 303 to `/` (303 so the browser turns the POST into a `GET /`
    rather than replaying it).

  Both responses carry `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store`. `no-referrer` is load-bearing, not hygiene: the
  interstitial's own URL carries the token, so without it the browser would
  send `Referer: …/api/auth/link?token=…` on the POST.

  **Why not redeem on GET, like before?** Discord's own link-preview crawler
  (`Discordbot/2.0`) fetches every URL in a message it renders, including an
  ephemeral one. When redemption happened on GET, the crawler consumed the
  single-use token seconds before the human clicked — every real click got
  "invalid or expired", and on a fresh install with no admin yet, the crawler
  even took the claim-on-first-login bootstrap. `/dashboard`'s reply also
  wraps the link in `<…>` and sets `MessageFlags.SuppressEmbeds` as
  belt-and-braces, but neither is a documented guarantee that Discord won't
  fetch it — the real fix is that GET no longer writes anything. A bare
  `HEAD` needs no separate handling either: Hono re-dispatches `HEAD` as
  `GET` internally, so it's automatically harmless once GET is.
- `web/auth.ts` (`DashboardAuth`) — signs/verifies the session cookie
  (`{sub, isAdmin, exp}`), HMAC over `app_config`'s
  `dashboard_cookie_secret`, HttpOnly + `Secure` (when `DASHBOARD_PUBLIC_URL`
  is https — see `context.ts`) + `SameSite=Strict`, 30-day rolling TTL
  (re-issued on every authenticated request via `touch`). `SameSite=Strict`
  stays Strict even with the two-step redeem above: the cookie is set on a
  same-site POST from our own interstitial page, not on a cross-site
  navigation from discord.com, so it's still sent on the follow-up
  `303 → GET /`.
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
| `GET /api/auth/link` | render the auto-submitting interstitial — verifies the token, never spends it |
| `POST /api/auth/link` | spend the token, issue the session cookie, 303 to `/` |
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
| `GET /api/migrate/status` | whether the upgrade wizard is needed, which legacy keys remain |
| `POST /api/migrate/claude/claim`, `.../claude/discard`, `.../api-key/discard` | adopt/discard the legacy `claudeOauthToken`/`anthropicApiKey` |
| `POST /api/migrate/github/claim`, `.../github/discard` | adopt/discard the legacy `githubToken` |
| `POST /api/migrate/password/discard` | clear the legacy dashboard password hash |
| `POST /api/migrate/profiles/backfill` | resolve profiles for linked users who never opened the dashboard |
| `POST /api/migrate/complete` | stamp `migration_version`, dismissing the wizard for good |

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
(self-service link status + usage) once done. `AdminApp` first checks
`GET /api/migrate/status`: while `needed` is true it renders `Migrate.tsx`
(the upgrade wizard, see `guide/migration.md`) instead of the normal
five-page router (Overview/Setup/Access/Sessions/Usage) — this only ever
fires for an install with prior state from before per-user accounts existed.

The trigger logic itself (`hasPriorState`, `stampFreshInstall`) lives in
`src/migration.ts`, framework-free so `context.ts` can call it during
`createContext` — a fresh install gets `migration_version` stamped
immediately, before the web server or any route even exists.

### Dev workflow

```bash
npm run dev            # bot + API on :3000
npm run dev:dashboard  # Vite on :5173, proxies /api → :3000
```

The production build (`npm run build`) outputs static files the bot serves
itself — no separate frontend deployment exists.
