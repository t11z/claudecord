import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AppContext } from "../context.js";
import { requireAdmin } from "./middleware.js";
import { authRoutes } from "./routes/auth.js";
import { claudeRoutes } from "./routes/claude.js";
import { configRoutes } from "./routes/config.js";
import { githubRoutes } from "./routes/github.js";
import { guildConfigRoutes } from "./routes/guild-config.js";
import { meRoutes } from "./routes/me.js";
import { sessionRoutes } from "./routes/sessions.js";
import { setupRoutes } from "./routes/setup.js";
import { statsRoutes } from "./routes/stats.js";
import { statusRoutes } from "./routes/status.js";

/**
 * Builds the API app without binding a port — split out from
 * `startWebServer` so tests can exercise the real route-gating wiring via
 * `app.request()` (see tests/web-route-gating.test.ts) without a live
 * listener. `includeStatic` is skipped in tests; the built dashboard isn't
 * part of what route gating needs to verify.
 */
export function buildApiApp(ctx: AppContext, includeStatic = true): Hono {
  const app = new Hono();

  // Unauthenticated: this is the only door in. A session can only be minted
  // by redeeming a `/dashboard` magic link — there is no password anywhere.
  authRoutes(app, ctx);

  // Self-scoped to the caller's own `sub` (requireUser, not requireAdmin) —
  // registered before the blanket gate below for the same reason authRoutes is.
  meRoutes(app, ctx);

  // Gated per-guild (admin OR Manage Guild on that specific guild) rather
  // than instance-wide admin — also registered before the blanket gate.
  guildConfigRoutes(app, ctx);

  // Everything registered from here on requires an admin session. Routes
  // registered *before* this line (authRoutes/meRoutes/guildConfigRoutes
  // above) are exempt, since Hono composes each path's handler chain from
  // registrations up to that point — this mirrors how /api/auth/* was
  // already exempted pre-rewrite.
  app.use("/api/*", requireAdmin(ctx.auth));

  statusRoutes(app, ctx);
  setupRoutes(app, ctx);
  configRoutes(app, ctx);
  githubRoutes(app, ctx);
  claudeRoutes(app, ctx);
  sessionRoutes(app, ctx);
  statsRoutes(app, ctx);

  if (includeStatic) {
    // Built dashboard (packages/dashboard → public/). In dev, Vite serves the
    // frontend itself and proxies /api here.
    const publicDir = path.relative(
      process.cwd(),
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public"),
    );
    app.use("/*", serveStatic({ root: publicDir }));
    app.get("*", serveStatic({ root: publicDir, path: "index.html" }));
  }

  return app;
}

export function startWebServer(ctx: AppContext): ServerType {
  const { DASHBOARD_HOST: host, DASHBOARD_PORT: port } = ctx.env;
  const app = buildApiApp(ctx);
  const server = serve({ fetch: app.fetch, hostname: host, port });
  ctx.logger.info({ host, port }, "dashboard listening");
  return server;
}
