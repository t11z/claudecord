import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AppContext } from "../context.js";
import { isLocalhost } from "../env.js";
import { DashboardAuth } from "./auth.js";
import { configRoutes } from "./routes/config.js";
import { githubRoutes } from "./routes/github.js";
import { sessionRoutes } from "./routes/sessions.js";
import { setupRoutes } from "./routes/setup.js";
import { statsRoutes } from "./routes/stats.js";
import { statusRoutes } from "./routes/status.js";

export interface WebServerHooks {
  /** Called by the setup wizard after a Discord token was stored. */
  onDiscordTokenSaved: () => Promise<string | null>;
}

/**
 * Resolves the effective dashboard password for a non-localhost bind without
 * ever starting the server unauthenticated. A crash loop here would make the
 * setup wizard itself unreachable, so a missing password is bootstrapped
 * instead of treated as a fatal config error: reuse a previously generated
 * one, or mint and persist a new one and log it exactly once.
 */
function resolveBindPassword(
  ctx: AppContext,
  host: string,
  password: string | undefined,
): string | undefined {
  if (isLocalhost(host) || password || ctx.env.DASHBOARD_INSECURE_BIND) return password;

  const existing = ctx.secrets.get().dashboardPassword;
  if (existing) return existing;

  const generated = crypto.randomBytes(18).toString("base64url");
  ctx.secrets.update({ dashboardPassword: generated });
  ctx.logger.warn(
    `DASHBOARD_HOST is set to "${host}" (not localhost) but DASHBOARD_PASSWORD is empty. ` +
      `Generated a one-time dashboard password so the setup wizard stays reachable: ${generated} ` +
      "Set DASHBOARD_PASSWORD to replace it with a permanent one.",
  );
  return generated;
}

export function startWebServer(ctx: AppContext, hooks: WebServerHooks): ServerType {
  const { DASHBOARD_HOST: host, DASHBOARD_PORT: port } = ctx.env;
  const password = resolveBindPassword(ctx, host, ctx.env.DASHBOARD_PASSWORD);

  const auth = new DashboardAuth(ctx, password);
  const app = new Hono();

  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { password?: string };
    if (!auth.required) return c.json({ ok: true });
    if (typeof body.password === "string" && auth.verifyPassword(body.password)) {
      auth.issueCookie(c);
      return c.json({ ok: true });
    }
    return c.json({ error: "wrong password" }, 401);
  });

  app.post("/api/auth/logout", (c) => {
    auth.clearCookie(c);
    return c.json({ ok: true });
  });

  app.get("/api/auth/required", (c) =>
    c.json({ required: auth.required, authenticated: auth.isAuthenticated(c) }),
  );

  app.use("/api/*", auth.middleware());

  statusRoutes(app, ctx);
  setupRoutes(app, ctx, hooks);
  configRoutes(app, ctx);
  githubRoutes(app, ctx);
  sessionRoutes(app, ctx);
  statsRoutes(app, ctx);

  // Built dashboard (packages/dashboard → public/). In dev, Vite serves the
  // frontend itself and proxies /api here.
  const publicDir = path.relative(
    process.cwd(),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public"),
  );
  app.use("/*", serveStatic({ root: publicDir }));
  app.get("*", serveStatic({ root: publicDir, path: "index.html" }));

  const server = serve({ fetch: app.fetch, hostname: host, port });
  ctx.logger.info({ host, port, passwordProtected: auth.required }, "dashboard listening");
  return server;
}
