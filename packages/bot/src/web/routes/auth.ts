import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { AuthSessionDto } from "../../types.js";

/**
 * Decides whether a redeemed link should mint an admin session. Three ways
 * in, checked in order:
 *   1. The env var is authoritative when set — always wins, never demotes.
 *   2. An existing stored admin flag is never silently revoked by this
 *      login path; revoking admin is an explicit dashboard action.
 *   3. Bootstrap: if nobody is an admin yet and DASHBOARD_ADMIN_IDS is empty,
 *      whoever ran `/dashboard` with Manage Guild on that server claims it.
 *      Only possible once, while the admin set is genuinely empty.
 */
export function decideIsAdmin(
  ctx: AppContext,
  sub: string,
  hasManageGuild: boolean,
  existing: boolean,
): boolean {
  if (ctx.env.DASHBOARD_ADMIN_IDS.includes(sub)) return true;
  if (existing) return true;
  if (ctx.env.DASHBOARD_ADMIN_IDS.length === 0 && !ctx.repos.dashboardUsers.anyAdmin()) {
    return hasManageGuild;
  }
  return false;
}

export function authRoutes(app: Hono, ctx: AppContext): void {
  /**
   * Redeems a `/dashboard` link: verify + single-use consume, decide the
   * role, persist the profile, issue the session cookie, redirect to a clean
   * URL. Redeeming on GET (rather than requiring a follow-up POST) keeps this
   * a true one-click flow from the ephemeral Discord message.
   */
  app.get("/api/auth/link", (c) => {
    const token = c.req.query("token");
    const claims = token ? ctx.magicLink.consume(token) : null;
    if (!claims) {
      return c.text("This link is invalid or has expired. Run /dashboard again.", 400);
    }

    const existing = ctx.repos.dashboardUsers.get(claims.sub);
    const isAdmin = decideIsAdmin(
      ctx,
      claims.sub,
      claims.hasManageGuild,
      existing?.isAdmin ?? false,
    );
    if (isAdmin && !(existing?.isAdmin ?? false)) {
      ctx.logger.warn({ userId: claims.sub }, "dashboard admin granted");
    }

    ctx.repos.dashboardUsers.upsertLogin({
      discordUserId: claims.sub,
      username: claims.username,
      globalName: claims.globalName,
      avatarUrl: claims.avatarUrl,
      isAdmin,
      now: new Date().toISOString(),
    });

    ctx.auth.issueCookie(c, { sub: claims.sub, isAdmin });
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect("/", 302);
  });

  /** Null user when signed out — this route is intentionally not behind auth middleware. */
  app.get("/api/auth/session", (c) => {
    const session = ctx.auth.getSession(c);
    if (!session) {
      return c.json<AuthSessionDto>({ user: null, isAdmin: false });
    }
    const profile = ctx.repos.dashboardUsers.get(session.sub);
    return c.json<AuthSessionDto>({
      user: {
        id: session.sub,
        username: profile?.username ?? null,
        globalName: profile?.globalName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      isAdmin: session.isAdmin,
    });
  });

  app.post("/api/auth/logout", (c) => {
    ctx.auth.clearCookie(c);
    return c.json({ ok: true });
  });
}
