import crypto from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppConfigRepo } from "../db/repos/app-config.js";

const COOKIE_NAME = "claudecord_sid";
/**
 * Rolling 30 days: the identity behind a session is a stable Discord user, not
 * a password, so there's no reason to force a re-visit to `/dashboard` more
 * than about once a month. Re-issued on every authenticated request.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  /** Discord user id. Every session has one — there is no identity-less login. */
  sub: string;
  isAdmin: boolean;
}

interface SessionPayload extends Session {
  exp: number;
}

export interface DashboardAuthOptions {
  /**
   * Sets `Secure` on the session cookie. Not unconditional: a Secure cookie
   * cannot be set over plain http, which is the normal `npm run dev` /
   * `http://localhost:3000` setup — forcing it on would lock local dev out of
   * its own dashboard. `context.ts` derives it from `DASHBOARD_PUBLIC_URL`
   * being https.
   */
  secure?: boolean;
  now?: () => number;
}

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Signs and verifies the dashboard session cookie. There is no password path
 * anymore — the only way to mint a session is redeeming a magic link from
 * `/dashboard` (see `magic-link.ts` and `routes/auth.ts`).
 *
 * `sameSite: "Strict"` stays Strict even now that redemption is a two-step
 * GET-then-POST flow: the cookie is set on a same-site POST from our own
 * interstitial page, not on a cross-site navigation from discord.com, so
 * Strict is still sent on the follow-up 303 → `GET /`.
 */
export class DashboardAuth {
  private readonly secret: string;
  private readonly secure: boolean;
  private readonly now: () => number;

  constructor(appConfig: AppConfigRepo, options: DashboardAuthOptions = {}) {
    this.secure = options.secure ?? false;
    this.now = options.now ?? Date.now;
    this.secret = appConfig.getOrInit("dashboard_cookie_secret", () =>
      crypto.randomBytes(32).toString("base64url"),
    );
  }

  issueCookie(c: Context, session: Session): void {
    const payload: SessionPayload = { ...session, exp: this.now() + SESSION_TTL_MS };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    setCookie(c, COOKIE_NAME, `${encoded}.${hmac(this.secret, encoded)}`, {
      httpOnly: true,
      secure: this.secure,
      sameSite: "Strict",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  clearCookie(c: Context): void {
    deleteCookie(c, COOKIE_NAME, { path: "/", secure: this.secure });
  }

  /** Verifies and decodes the session cookie, or null if absent/tampered/expired. */
  getSession(c: Context): Session | null {
    const cookie = getCookie(c, COOKIE_NAME);
    if (!cookie) return null;
    const dot = cookie.lastIndexOf(".");
    if (dot <= 0) return null;
    const encoded = cookie.slice(0, dot);
    const signature = cookie.slice(dot + 1);
    const expected = hmac(this.secret, encoded);
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }

    let payload: SessionPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp <= this.now()) return null;
    return { sub: payload.sub, isAdmin: payload.isAdmin };
  }

  /** Re-issues the cookie with a fresh expiry, keeping an active session rolling. */
  touch(c: Context, session: Session): void {
    this.issueCookie(c, session);
  }
}
