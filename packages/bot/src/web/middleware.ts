import type { Context, Next } from "hono";
import type { DashboardAuth } from "./auth.js";

/** Rejects unauthenticated requests. Any signed-in Discord user passes. */
export function requireUser(auth: DashboardAuth) {
  return async (c: Context, next: Next) => {
    const session = auth.getSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    auth.touch(c, session);
    await next();
  };
}

/**
 * Rejects unauthenticated requests (401) and non-admin sessions (403). Every
 * route that existed before per-user dashboard accounts (status, setup,
 * config, github/claude identity lists, sessions, stats) manages the whole
 * instance or lists every user's data, so all of them require admin — see
 * `server.ts` for where this is wired onto each route group.
 */
export function requireAdmin(auth: DashboardAuth) {
  return async (c: Context, next: Next) => {
    const session = auth.getSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    if (!session.isAdmin) return c.json({ error: "forbidden" }, 403);
    auth.touch(c, session);
    await next();
  };
}
