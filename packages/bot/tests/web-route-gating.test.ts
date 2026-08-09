import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppContext, createContext } from "../src/context.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/logger.js";
import { buildApiApp } from "../src/web/server.js";

/**
 * Exercises the REAL route wiring from server.ts — not a reimplementation —
 * against every route group that existed before per-user dashboard accounts.
 * This is the test the plan calls out as making a forgotten requireAdmin()
 * a failing test rather than a review question.
 */

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-gating-test-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeApp(): { ctx: AppContext; app: Hono } {
  const env = loadEnv({ DATA_DIR: dataDir });
  const ctx = createContext(env, createLogger("silent"));
  return { ctx, app: buildApiApp(ctx, false) };
}

async function mintCookie(ctx: AppContext, isAdmin: boolean): Promise<string> {
  const mini = new Hono();
  mini.get("/set", (c) => {
    ctx.auth.issueCookie(c, { sub: "test-user", isAdmin });
    return c.text("ok");
  });
  const res = await mini.request("/set");
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("no set-cookie header");
  return raw.split(";")[0]!;
}

const ADMIN_ROUTES: { method: string; path: string }[] = [
  { method: "GET", path: "/api/status" },
  { method: "POST", path: "/api/setup/github-app" },
  { method: "GET", path: "/api/guilds" },
  { method: "GET", path: "/api/guilds/g1/config" },
  { method: "PUT", path: "/api/guilds/g1/config" },
  { method: "GET", path: "/api/github/identities" },
  { method: "DELETE", path: "/api/github/identities/u1" },
  { method: "GET", path: "/api/claude/identities" },
  { method: "DELETE", path: "/api/claude/identities/u1" },
  { method: "POST", path: "/api/claude/identities/u1/check" },
  { method: "GET", path: "/api/sessions" },
  { method: "DELETE", path: "/api/sessions/t1" },
  { method: "POST", path: "/api/sessions/t1/abort" },
  { method: "GET", path: "/api/stats" },
];

describe("route gating: every pre-existing admin route", () => {
  it("401s every route with no session", async () => {
    const { app } = makeApp();
    for (const r of ADMIN_ROUTES) {
      const res = await app.request(r.path, { method: r.method });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it("403s every route for a signed-in NON-admin session — the actual privilege-escalation check", async () => {
    const { ctx, app } = makeApp();
    const cookie = await mintCookie(ctx, false);
    for (const r of ADMIN_ROUTES) {
      const res = await app.request(r.path, { method: r.method, headers: { Cookie: cookie } });
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
    }
  });

  it("lets an admin session reach the handler (never 401/403)", async () => {
    const { ctx, app } = makeApp();
    const cookie = await mintCookie(ctx, true);
    for (const r of ADMIN_ROUTES) {
      const res = await app.request(r.path, { method: r.method, headers: { Cookie: cookie } });
      expect([401, 403], `${r.method} ${r.path} returned ${res.status}`).not.toContain(res.status);
    }
  });
});

describe("route gating: /api/auth/* is intentionally exempt", () => {
  it("session and logout work with no admin session", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/auth/session")).status).toBe(200);
    expect((await app.request("/api/auth/logout", { method: "POST" })).status).toBe(200);
  });
});
