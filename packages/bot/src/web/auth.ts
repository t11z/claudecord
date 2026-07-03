import crypto from "node:crypto";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../context.js";

const COOKIE_NAME = "claudecord_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export class DashboardAuth {
  private readonly secret: string;

  constructor(
    ctx: AppContext,
    private readonly password: string | undefined,
  ) {
    this.secret = ctx.repos.appConfig.getOrInit("dashboard_cookie_secret", () =>
      crypto.randomBytes(32).toString("base64url"),
    );
  }

  get required(): boolean {
    return this.password !== undefined;
  }

  verifyPassword(candidate: string): boolean {
    if (!this.password) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.password);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  issueCookie(c: Context): void {
    const expires = Date.now() + SESSION_TTL_MS;
    const payload = String(expires);
    setCookie(c, COOKIE_NAME, `${payload}.${hmac(this.secret, payload)}`, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  clearCookie(c: Context): void {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
  }

  isAuthenticated(c: Context): boolean {
    if (!this.required) return true;
    const cookie = getCookie(c, COOKIE_NAME);
    if (!cookie) return false;
    const dot = cookie.lastIndexOf(".");
    if (dot <= 0) return false;
    const payload = cookie.slice(0, dot);
    const signature = cookie.slice(dot + 1);
    const expected = hmac(this.secret, payload);
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return false;
    }
    return Number.parseInt(payload, 10) > Date.now();
  }

  middleware() {
    return async (c: Context, next: Next) => {
      if (!this.isAuthenticated(c)) {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    };
  }
}
