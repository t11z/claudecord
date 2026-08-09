import type { Context, Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { AuthSessionDto } from "../../types.js";

/** Every dead end of the link flow says the same thing — one string, both routes. */
const LINK_INVALID = "This link is invalid or has expired. Run /dashboard again.";

/**
 * Headers every response of both link routes gets. `no-referrer` is
 * load-bearing, not hygiene: the interstitial's own URL carries the token, so
 * without it the browser would send `Referer: …/api/auth/link?token=…` on the
 * POST — which is exactly where the token was found leaking, in the reverse
 * proxy's access log. `no-store` keeps a token-bearing page out of every
 * cache, and makes the back button re-request the (now spent) link and get
 * the honest "expired" page instead of silently re-POSTing.
 */
function linkHeaders(c: Context): void {
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
}

/**
 * Escapes for a double-quoted HTML attribute. A signature-valid token is
 * base64url plus a dot and cannot contain any of these — but keeping the
 * escape here keeps that invariant local to the one function that renders
 * it, instead of spread across the route, the issuer and the HMAC.
 */
function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The same "invalid or expired" message as HTML. Both link routes are
 * browser navigations now, not API calls — a bare `c.text(...)` would leave
 * the user staring at plain text on a blank page at exactly the moment they
 * expect to be signed in, the same dead end this fix exists to remove, one
 * layer down.
 */
function errorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Sign-in link expired</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 28rem;
             padding: 0 1rem; text-align: center; }
    </style>
  </head>
  <body>
    <p>${LINK_INVALID}</p>
  </body>
</html>
`;
}

/**
 * The page `GET /api/auth/link` renders. Its whole job is to turn the
 * crawler-visible GET into a POST, which unfurlers never make. Auto-submitted,
 * so a human sees a flash at most; `<noscript>` keeps it working without JS.
 * The form action carries no query string on purpose — the token travels in
 * the body, so it never appears in the POST's request line or the proxy log.
 * There is no CSP middleware today; if one is ever added, this inline script
 * needs a nonce or hash, or the noscript button becomes the only path.
 */
function interstitial(token: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Signing in…</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 28rem;
             padding: 0 1rem; text-align: center; }
    </style>
  </head>
  <body>
    <p>Signing you in…</p>
    <form id="signin" method="post" action="/api/auth/link">
      <input type="hidden" name="token" value="${escapeAttr(token)}" />
      <noscript><button type="submit">Continue to the dashboard</button></noscript>
    </form>
    <script>
      document.getElementById("signin").submit();
    </script>
  </body>
</html>
`;
}

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
   * Step 1 of sign-in, and deliberately side-effect-free: no role decision,
   * no `dashboard_users` write, no cookie. Discord's unfurl crawler
   * (`Discordbot/2.0`) fetches every URL in a message, and this route used to
   * consume the token on GET — so the crawler spent the single-use nonce
   * seconds before the human clicked, every real click 400ed, and on an
   * install with no admin yet the crawler even took the bootstrap claim (see
   * `decideIsAdmin` below). `peek` verifies without spending, so a stale link
   * says so here instead of only after the POST below. A bare `HEAD` lands
   * here too and is harmless for the same reason: Hono re-dispatches HEAD as
   * GET internally, so it cannot be handled — and handling it separately is
   * unnecessary once GET writes nothing.
   */
  app.get("/api/auth/link", (c) => {
    linkHeaders(c);
    const token = c.req.query("token");
    if (!token || !ctx.magicLink.peek(token)) return c.html(errorPage(), 400);
    return c.html(interstitial(token));
  });

  /**
   * Step 2, and the only place a link is ever spent: consume, decide the
   * role, persist the profile, issue the session cookie, redirect to a clean
   * URL. Reached from the interstitial above rather than straight from
   * Discord, because preview crawlers only ever issue GET/HEAD. 303, not 302,
   * so the browser turns this POST into a GET of `/` rather than replaying
   * the POST.
   */
  app.post("/api/auth/link", async (c) => {
    linkHeaders(c);
    // parseBody, not formData: it returns {} for a non-form content type
    // instead of throwing, so a junk POST is a 400 and not a 500.
    const field = (await c.req.parseBody()).token;
    const token = typeof field === "string" ? field : null;
    const claims = token ? ctx.magicLink.consume(token) : null;
    if (!claims) return c.html(errorPage(), 400);

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
    return c.redirect("/", 303);
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
