import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppContext, createContext } from "../src/context.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/logger.js";
import { type MagicLinkClaims, MagicLinkIssuer } from "../src/web/magic-link.js";
import { buildApiApp } from "../src/web/server.js";

/**
 * Exercises the actual two-step `/api/auth/link` flow end to end: minting via
 * the real MagicLinkIssuer, visiting the (non-consuming) GET interstitial,
 * redeeming through the real POST route, and inspecting the resulting
 * cookie/session/dashboard_users row. This is also where the plan's three
 * admin-bootstrap paths (env override, sticky existing flag, claim-on-first-
 * login) actually get decided.
 */

let dataDir: string;
let env: ReturnType<typeof loadEnv>;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-link-test-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeApp(extraEnv: Record<string, string> = {}) {
  env = loadEnv({ DATA_DIR: dataDir, ...extraEnv });
  const ctx: AppContext = createContext(env, createLogger("silent"));
  return { ctx, app: buildApiApp(ctx, false) };
}

/** Step 1: the interstitial. Must never spend the token. */
async function visit(app: Hono, token: string): Promise<Response> {
  return app.request(`/api/auth/link?token=${token}`);
}

/** Step 2: the POST the interstitial submits — the only step that spends the token. */
async function redeem(app: Hono, token: string): Promise<Response> {
  return app.request("/api/auth/link", {
    method: "POST",
    body: new URLSearchParams({ token }),
    redirect: "manual",
  });
}

const CLAIMS: MagicLinkClaims = {
  sub: "u1",
  username: "alice",
  globalName: "Alice",
  avatarUrl: null,
  hasManageGuild: false,
};

describe("GET /api/auth/link (interstitial)", () => {
  it("rejects a missing or garbage token without crashing", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/auth/link")).status).toBe(400);
    expect((await visit(app, "garbage")).status).toBe(400);
  });

  it("does not spend the token", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);

    const res = await visit(app, token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("set-cookie")).toBeNull();
    // Load-bearing on this exact response: this URL carries the token, so
    // without no-referrer the browser would send it as Referer on the POST
    // the page submits — the leak this fix removes.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain('action="/api/auth/link"');
    expect(body).toContain(token);
    expect(ctx.repos.dashboardUsers.get("u1")).toBeUndefined();

    // The token is still good — the interstitial GET was a no-op.
    expect((await redeem(app, token)).status).toBe(303);
  });

  it("HEAD does not spend the token either", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);
    const headRes = await app.request(`/api/auth/link?token=${token}`, { method: "HEAD" });
    // Hono re-dispatches HEAD as GET internally and strips the body — there
    // is no way to register a separate HEAD handler, so this asserts the
    // outcome (nothing spent) rather than a specific HEAD code path.
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe("");
    expect((await redeem(app, token)).status).toBe(303);
  });

  it("a spent link says so on the GET too, before any POST", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);
    expect((await redeem(app, token)).status).toBe(303);
    expect((await visit(app, token)).status).toBe(400);
  });

  it("an expired token is rejected on both steps", async () => {
    const { ctx, app } = makeApp();
    const secret = ctx.repos.appConfig.getOrInit("magic_link_secret", () => "unused");
    const expiredIssuer = new MagicLinkIssuer(secret, () => Date.now() - 10 * 60 * 1000);
    const token = expiredIssuer.mint(CLAIMS);
    expect((await visit(app, token)).status).toBe(400);
    expect((await redeem(app, token)).status).toBe(400);
  });

  it("the error path sets Referrer-Policy and Cache-Control too", async () => {
    const { app } = makeApp();
    const getRes = await visit(app, "garbage");
    expect(getRes.headers.get("referrer-policy")).toBe("no-referrer");
    expect(getRes.headers.get("cache-control")).toBe("no-store");

    const postRes = await redeem(app, "garbage");
    expect(postRes.headers.get("referrer-policy")).toBe("no-referrer");
    expect(postRes.headers.get("cache-control")).toBe("no-store");
  });

  it("reaches the real handler in the production app shape, not the static fallback", async () => {
    // Every other test here builds with includeStatic=false; the app that
    // actually deploys is includeStatic=true, which also registers
    // `app.use("/*", serveStatic(...))` and a catch-all `app.get("*", ...)`.
    // Registration order should make authRoutes win regardless, but that's
    // reasoning, not a test — and a silent fall-through to serveStatic
    // returning 200 with the SPA is exactly the failure mode a trailing
    // slash on DASHBOARD_PUBLIC_URL produced for `//api/auth/link`.
    env = loadEnv({ DATA_DIR: dataDir });
    const ctx = createContext(env, createLogger("silent"));
    const app = buildApiApp(ctx, true);

    expect((await redeem(app, "garbage")).status).toBe(400);
    const token = ctx.magicLink.mint(CLAIMS);
    expect((await redeem(app, token)).status).toBe(303);
  });
});

describe("POST /api/auth/link (redeem)", () => {
  it("rejects a missing or garbage token without crashing", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/auth/link", { method: "POST" })).status).toBe(400);
    expect((await redeem(app, "garbage")).status).toBe(400);
  });

  it("redeeming a valid token issues a cookie, 303s, and persists the profile", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);

    const res = await redeem(app, token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("claudecord_sid=");
    expect(cookie).toContain("HttpOnly");

    const stored = ctx.repos.dashboardUsers.get("u1");
    expect(stored?.username).toBe("alice");
    expect(stored?.isAdmin).toBe(false); // no Manage Guild, no admin set

    const sessionRes = await app.request("/api/auth/session", {
      headers: { Cookie: cookie!.split(";")[0]! },
    });
    expect(await sessionRes.json()).toEqual({
      user: { id: "u1", username: "alice", globalName: "Alice", avatarUrl: null },
      isAdmin: false,
      discordOAuthConfigured: false,
    });
  });

  it("the same token cannot be redeemed twice", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);
    expect((await redeem(app, token)).status).toBe(303);
    expect((await redeem(app, token)).status).toBe(400);
  });
});

describe("admin decision on redeem", () => {
  it("claims admin for the first login with Manage Guild when no admin exists and no env override", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: true });
    await redeem(app, token);
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
  });

  it("does NOT claim admin without Manage Guild", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: false });
    await redeem(app, token);
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);
  });

  it("only the first login can claim — a second Manage Guild user does not also become admin", async () => {
    const { ctx, app } = makeApp();
    const first = ctx.magicLink.mint({ ...CLAIMS, sub: "u1", hasManageGuild: true });
    await redeem(app, first);

    const second = ctx.magicLink.mint({ ...CLAIMS, sub: "u2", hasManageGuild: true });
    await redeem(app, second);

    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
    expect(ctx.repos.dashboardUsers.get("u2")?.isAdmin).toBe(false);
  });

  it("DASHBOARD_ADMIN_IDS is authoritative and skips the Manage Guild claim entirely", async () => {
    const { ctx, app } = makeApp({ DASHBOARD_ADMIN_IDS: "u2" });
    const token = ctx.magicLink.mint({ ...CLAIMS, sub: "u1", hasManageGuild: true });
    await redeem(app, token);
    // u1 has Manage Guild but isn't the listed admin, and the env var being
    // set at all disables the bootstrap-claim path for everyone else.
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);

    const token2 = ctx.magicLink.mint({ ...CLAIMS, sub: "u2", hasManageGuild: false });
    await redeem(app, token2);
    expect(ctx.repos.dashboardUsers.get("u2")?.isAdmin).toBe(true);
  });

  it("an existing admin is never demoted by a later login without Manage Guild", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: true });
    await redeem(app, token);
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);

    const relogin = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: false });
    await redeem(app, relogin);
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
  });
});
