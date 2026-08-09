import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppContext, createContext } from "../src/context.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/logger.js";
import type { MagicLinkClaims } from "../src/web/magic-link.js";
import { buildApiApp } from "../src/web/server.js";

/**
 * Exercises the actual `/api/auth/link` redeem endpoint end to end: minting
 * via the real MagicLinkIssuer, redeeming through the real Hono route, and
 * inspecting the resulting cookie/session/dashboard_users row. This is where
 * the plan's three admin-bootstrap paths (env override, sticky existing
 * flag, claim-on-first-login) actually get decided.
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

const CLAIMS: MagicLinkClaims = {
  sub: "u1",
  username: "alice",
  globalName: "Alice",
  avatarUrl: null,
  hasManageGuild: false,
};

describe("GET /api/auth/link", () => {
  it("rejects a missing or garbage token without crashing", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/auth/link")).status).toBe(400);
    expect((await app.request("/api/auth/link?token=garbage")).status).toBe(400);
  });

  it("redeeming a valid token issues a cookie, 302s, and persists the profile", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);

    const res = await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" });
    expect(res.status).toBe(302);
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
    });
  });

  it("the same token cannot be redeemed twice", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint(CLAIMS);
    expect(
      (await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" })).status,
    ).toBe(302);
    expect(
      (await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" })).status,
    ).toBe(400);
  });
});

describe("admin decision on redeem", () => {
  it("claims admin for the first login with Manage Guild when no admin exists and no env override", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: true });
    await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" });
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
  });

  it("does NOT claim admin without Manage Guild", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: false });
    await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" });
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);
  });

  it("only the first login can claim — a second Manage Guild user does not also become admin", async () => {
    const { ctx, app } = makeApp();
    const first = ctx.magicLink.mint({ ...CLAIMS, sub: "u1", hasManageGuild: true });
    await app.request(`/api/auth/link?token=${first}`, { redirect: "manual" });

    const second = ctx.magicLink.mint({ ...CLAIMS, sub: "u2", hasManageGuild: true });
    await app.request(`/api/auth/link?token=${second}`, { redirect: "manual" });

    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
    expect(ctx.repos.dashboardUsers.get("u2")?.isAdmin).toBe(false);
  });

  it("DASHBOARD_ADMIN_IDS is authoritative and skips the Manage Guild claim entirely", async () => {
    const { ctx, app } = makeApp({ DASHBOARD_ADMIN_IDS: "u2" });
    const token = ctx.magicLink.mint({ ...CLAIMS, sub: "u1", hasManageGuild: true });
    await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" });
    // u1 has Manage Guild but isn't the listed admin, and the env var being
    // set at all disables the bootstrap-claim path for everyone else.
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);

    const token2 = ctx.magicLink.mint({ ...CLAIMS, sub: "u2", hasManageGuild: false });
    await app.request(`/api/auth/link?token=${token2}`, { redirect: "manual" });
    expect(ctx.repos.dashboardUsers.get("u2")?.isAdmin).toBe(true);
  });

  it("an existing admin is never demoted by a later login without Manage Guild", async () => {
    const { ctx, app } = makeApp();
    const token = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: true });
    await app.request(`/api/auth/link?token=${token}`, { redirect: "manual" });
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);

    const relogin = ctx.magicLink.mint({ ...CLAIMS, hasManageGuild: false });
    await app.request(`/api/auth/link?token=${relogin}`, { redirect: "manual" });
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
  });
});
