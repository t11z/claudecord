---
title: Dashboard
description: API surface, auth model and frontend structure.
---

## Backend

A [Hono](https://hono.dev) app inside the bot process (`src/web/`). It
serves the JSON API under `/api/*` and the built frontend from
`packages/bot/public/`.

### Auth model

- Binding to localhost (the default) requires no password.
- A non-localhost `DASHBOARD_HOST` **requires** `DASHBOARD_PASSWORD` — the
  server refuses to start otherwise.
- When a password is set, `POST /api/auth/login` issues an HMAC-signed,
  HttpOnly, `SameSite=Strict` cookie (12 h). The signing secret is generated
  once and kept in `app_config`.

### Endpoints

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | connection state, auth method/validity, queue, invite URL |
| `POST /api/setup/claude-token` | store + validate a Claude credential (runs a probe query) |
| `POST /api/setup/check-auth` | re-validate current credentials |
| `POST /api/setup/discord-token` | store the bot token and hot-connect Discord |
| `GET /api/guilds` | servers the bot is in |
| `GET/PUT /api/guilds/:id/config` | allowlists, agentic toggle, model, extra prompt (GET includes channel/role pickers) |
| `GET /api/sessions` | thread↔session table with live running state |
| `DELETE /api/sessions/:threadId` | reset (drops the mapping, aborts if running) |
| `POST /api/sessions/:threadId/abort` | abort a running query |
| `GET /api/stats?window=30` | totals, daily series, top servers/users |

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

### Dev workflow

```bash
npm run dev            # bot + API on :3000
npm run dev:dashboard  # Vite on :5173, proxies /api → :3000
```

The production build (`npm run build`) outputs static files the bot serves
itself — no separate frontend deployment exists.
