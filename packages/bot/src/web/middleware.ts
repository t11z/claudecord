import { PermissionFlagsBits } from "discord.js";
import type { Context, Next } from "hono";
import type { AppContext } from "../context.js";
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

/**
 * Rejects unless the session is a dashboard admin OR holds Manage Guild on
 * the specific guild named by the `:id` route param — the same authority
 * `/config` already uses in Discord, and the right one for settings that
 * include an agentic-mode switch. A single-member REST fetch
 * (`guild.members.fetch(id)`) needs no privileged Guild Members intent —
 * that's only required for bulk/gateway member caching, not a one-off
 * lookup by id.
 */
export function requireGuildManager(ctx: AppContext) {
  return async (c: Context, next: Next) => {
    const session = ctx.auth.getSession(c);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    if (session.isAdmin) {
      ctx.auth.touch(c, session);
      await next();
      return;
    }

    const guildId = c.req.param("id");
    const guild = guildId ? ctx.discord?.guilds.cache.get(guildId) : undefined;
    if (!guild) return c.json({ error: "forbidden" }, 403);

    try {
      const member = await guild.members.fetch(session.sub);
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return c.json({ error: "forbidden" }, 403);
      }
    } catch {
      // Not a member (anymore), or the fetch failed — no access either way.
      return c.json({ error: "forbidden" }, 403);
    }

    ctx.auth.touch(c, session);
    await next();
  };
}
