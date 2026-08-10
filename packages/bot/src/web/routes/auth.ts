import type { Context, Hono } from "hono";
import type { AppContext } from "../../context.js";
import { publicUrl } from "../../discord/commands/dashboard.js";
import type { AuthSessionDto } from "../../types.js";
import { authorizeUrl, exchangeCode, fetchProfile, resolveLogin } from "../discord-oauth.js";

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

const PAGE_STYLE =
  "body { font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 28rem; " +
  "padding: 0 1rem; text-align: center; }";

/** A minimal standalone page — these are browser navigations, not API calls. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${title}</title>
    <style>
      ${PAGE_STYLE}
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`;
}

/**
 * The same "invalid or expired" message as HTML. A bare `c.text(...)` would
 * leave the user staring at plain text on a blank page at exactly the moment
 * they expect to be signed in.
 */
function errorPage(): string {
  return page("Sign-in link expired", `    <p>${LINK_INVALID}</p>`);
}

/** Escapes for HTML text content — OAuth failure messages are shown verbatim. */
function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Lands a completed Discord sign-in on a page of our own, which then navigates
 * to `/`.
 *
 * This hop is load-bearing, not decoration. The session cookie is
 * `SameSite=Strict`, and the OAuth callback arrives as a *cross-site*
 * navigation from discord.com — so a `303` straight to `/` risks the browser
 * withholding the brand-new cookie on that follow-up request, landing the user
 * on a signed-out dashboard right after a successful login. Navigating from our
 * own page makes the request same-site-initiated, so Strict applies as intended
 * and the magic-link path keeps its stricter cookie unchanged.
 */
function signedInPage(): string {
  return page(
    "Signing in…",
    `    <p>Signing you in…</p>
    <script>
      location.replace("/");
    </script>
    <noscript><p><a href="/">Continue to the dashboard</a></p></noscript>`,
  );
}

/** A failed Discord sign-in, explained, with the way back. */
function oauthErrorPage(message: string): string {
  return page(
    "Sign-in failed",
    `    <p>${escapeText(message)}</p>
    <p><a href="/">Back to sign-in</a></p>`,
  );
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
  return page(
    "Signing in…",
    `    <p>Signing you in…</p>
    <form id="signin" method="post" action="/api/auth/link">
      <input type="hidden" name="token" value="${escapeAttr(token)}" />
      <noscript><button type="submit">Continue to the dashboard</button></noscript>
    </form>
    <script>
      document.getElementById("signin").submit();
    </script>`,
  );
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
    const creds = ctx.credentials();
    const discordOAuthConfigured = !!(
      creds.discordApplicationId &&
      creds.discordClientSecret &&
      ctx.env.DASHBOARD_PUBLIC_URL
    );
    const session = ctx.auth.getSession(c);
    if (!session) {
      return c.json<AuthSessionDto>({ user: null, isAdmin: false, discordOAuthConfigured });
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
      discordOAuthConfigured,
    });
  });

  /**
   * Starts "Sign in with Discord". A plain redirect, so it must be reached by
   * top-level navigation (an `<a href>`), not a `fetch` — the browser has to
   * follow it to discord.com.
   *
   * Refuses rather than sending the user somewhere broken: without a client
   * secret there is nothing to exchange the code with, and without
   * `DASHBOARD_PUBLIC_URL` the redirect URI would be a guessed
   * `http://localhost:3000/…` that Discord rejects with an error page the
   * operator never sees.
   */
  app.get("/api/auth/discord/start", (c) => {
    linkHeaders(c);
    const creds = ctx.credentials();
    if (!creds.discordApplicationId || !creds.discordClientSecret) {
      return c.html(oauthErrorPage("Discord sign-in isn't set up on this bot yet."), 503);
    }
    if (!ctx.env.DASHBOARD_PUBLIC_URL) {
      return c.html(
        oauthErrorPage("This bot has no public URL configured, so Discord can't send you back."),
        503,
      );
    }
    const state = ctx.oauthState.mint({ kind: "discord-oauth" });
    return c.redirect(authorizeUrl(creds.discordApplicationId, publicUrl(ctx.env), state), 302);
  });

  /**
   * Completes the sign-in. Everything that decides *who* this is comes from
   * Discord's token exchange; everything that decides *what they may do* comes
   * from the bot's own connection (`resolveLogin`) — never from the user.
   */
  app.get("/api/auth/discord/callback", async (c) => {
    linkHeaders(c);
    const creds = ctx.credentials();
    if (!creds.discordApplicationId || !creds.discordClientSecret) {
      return c.html(oauthErrorPage("Discord sign-in isn't set up on this bot yet."), 503);
    }

    // Discord reports user-side failures (e.g. "access_denied") this way.
    const denied = c.req.query("error");
    if (denied) return c.html(oauthErrorPage(`Discord sign-in was cancelled (${denied}).`), 400);

    const code = c.req.query("code");
    const state = c.req.query("state");
    // Single-use and signed: a replayed or forged state is rejected here.
    if (!code || !state || !ctx.oauthState.consume(state)) {
      return c.html(oauthErrorPage("This sign-in link is invalid or has expired."), 400);
    }

    let profile: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      const accessToken = await exchangeCode(
        creds.discordApplicationId,
        creds.discordClientSecret,
        code,
        publicUrl(ctx.env),
      );
      profile = await fetchProfile(accessToken);
    } catch (err) {
      // Discord's own error string is third-party text reflected onto our
      // origin, and the user can't act on it either — log it, show ours.
      ctx.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "discord oauth exchange failed",
      );
      return c.html(
        oauthErrorPage("Couldn't complete the Discord sign-in. Please try again."),
        400,
      );
    }

    const decision = await resolveLogin(ctx, profile.id);
    if (!decision.ok) return c.html(oauthErrorPage(decision.message), decision.status);

    const existing = ctx.repos.dashboardUsers.get(profile.id);
    const isAdmin = decideIsAdmin(
      ctx,
      profile.id,
      decision.hasManageGuild,
      existing?.isAdmin ?? false,
    );
    if (isAdmin && !(existing?.isAdmin ?? false)) {
      ctx.logger.warn({ userId: profile.id }, "dashboard admin granted");
    }

    ctx.repos.dashboardUsers.upsertLogin({
      discordUserId: profile.id,
      username: profile.username,
      globalName: profile.globalName,
      avatarUrl: profile.avatarUrl,
      isAdmin,
      now: new Date().toISOString(),
    });

    ctx.auth.issueCookie(c, { sub: profile.id, isAdmin });
    // Not a redirect — see signedInPage() for why the same-site hop matters.
    return c.html(signedInPage());
  });

  app.post("/api/auth/logout", (c) => {
    ctx.auth.clearCookie(c);
    return c.json({ ok: true });
  });
}
