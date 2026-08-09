import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../src/context.js";

/**
 * /api/me/* is the acting user's own data only — every handler reads `sub`
 * from the session, never a path param, so these tests exercise the real
 * route wiring (like tests/web-route-gating.test.ts) rather than reimplement
 * the routes. Claude linking goes through the real engine, so the Agent SDK
 * is mocked the same way tests/runner.test.ts does; GitHub linking goes
 * through real `fetch`, so that's stubbed the way
 * tests/github-device-flow.test.ts does.
 */
const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

const { createContext } = await import("../src/context.js");
const { loadEnv } = await import("../src/env.js");
const { createLogger } = await import("../src/logger.js");
const { buildApiApp } = await import("../src/web/server.js");

function sdkStream(messages: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
  };
}

function claudeOk() {
  queryMock.mockReturnValue(
    sdkStream([
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "result", subtype: "success", is_error: false, result: "ok", session_id: "s1" },
    ]),
  );
}

function claudeFail() {
  queryMock.mockReturnValue(
    sdkStream([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["bad token"] },
    ]),
  );
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: test helper for reading response bodies of varying shapes
async function bodyOf(res: Response): Promise<any> {
  return res.json();
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-me-test-"));
  queryMock.mockReset();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function makeApp(): { ctx: AppContext; app: Hono } {
  const env = loadEnv({ DATA_DIR: dataDir });
  const ctx = createContext(env, createLogger("silent"));
  return { ctx, app: buildApiApp(ctx, false) };
}

/**
 * Mints and redeems a real magic link for `sub`, returning the resulting
 * session cookie — reuses the actual /api/auth/link POST handler (the way
 * the interstitial submits it) rather than poking DashboardAuth directly, so
 * these tests build on proven auth code.
 */
async function cookieFor(ctx: AppContext, app: Hono, sub: string): Promise<string> {
  const token = ctx.magicLink.mint({
    sub,
    username: `user-${sub}`,
    globalName: null,
    avatarUrl: null,
    hasManageGuild: false,
  });
  const res = await app.request("/api/auth/link", {
    method: "POST",
    body: new URLSearchParams({ token }),
    redirect: "manual",
  });
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("no set-cookie header");
  return raw.split(";")[0]!;
}

describe("/api/me/* requires a session", () => {
  it("401s every route with no cookie", async () => {
    const { app } = makeApp();
    const routes: { method: string; path: string }[] = [
      { method: "GET", path: "/api/me" },
      { method: "GET", path: "/api/me/usage" },
      { method: "POST", path: "/api/me/claude" },
      { method: "DELETE", path: "/api/me/claude" },
      { method: "POST", path: "/api/me/github/device" },
      { method: "POST", path: "/api/me/github/device/poll" },
      { method: "POST", path: "/api/me/github/skip" },
      { method: "DELETE", path: "/api/me/github" },
    ];
    for (const r of routes) {
      const res = await app.request(r.path, { method: r.method });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});

describe("GET /api/me", () => {
  it("starts incomplete, with claude unlinked and github unlinked/unskipped", async () => {
    const { ctx, app } = makeApp();
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me", { headers: { Cookie: cookie } });
    const body = await bodyOf(res);
    expect(body.claude.linked).toBe(false);
    expect(body.github.linked).toBe(false);
    expect(body.github.skipped).toBe(false);
    expect(body.onboardingComplete).toBe(false);
  });
});

describe("POST/DELETE /api/me/claude", () => {
  it("rejects an empty token without touching the engine", async () => {
    const { ctx, app } = makeApp();
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/claude", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "" }),
    });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a plain API key without touching the engine", async () => {
    const { ctx, app } = makeApp();
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/claude", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sk-ant-api-something" }),
    });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("links on a valid token and reflects in GET /api/me", async () => {
    const { ctx, app } = makeApp();
    const cookie = await cookieFor(ctx, app, "u1");
    claudeOk();
    const linkRes = await app.request("/api/me/claude", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sk-ant-oat01-real" }),
    });
    expect(linkRes.status).toBe(200);
    expect(ctx.claude.getToken("u1")).toBe("sk-ant-oat01-real");

    const meRes = await app.request("/api/me", { headers: { Cookie: cookie } });
    const me = await bodyOf(meRes);
    expect(me.claude.linked).toBe(true);
  });

  it("does not link when the engine check fails", async () => {
    const { ctx, app } = makeApp();
    const cookie = await cookieFor(ctx, app, "u1");
    claudeFail();
    const res = await app.request("/api/me/claude", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sk-ant-oat01-bad" }),
    });
    expect(res.status).toBe(400);
    expect(ctx.claude.getToken("u1")).toBeNull();
  });

  it("unlink only ever affects the caller's own identity", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("u1", "tok-1");
    ctx.claude.link("u2", "tok-2");
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/claude", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.claude.getToken("u1")).toBeNull();
    expect(ctx.claude.getToken("u2")).toBe("tok-2"); // untouched
  });
});

describe("POST /api/me/github/skip", () => {
  it("sets the flag and completes onboarding when claude is already linked", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("u1", "tok");
    const cookie = await cookieFor(ctx, app, "u1");

    const skipRes = await app.request("/api/me/github/skip", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(skipRes.status).toBe(200);

    const meRes = await app.request("/api/me", { headers: { Cookie: cookie } });
    const me = await bodyOf(meRes);
    expect(me.github.skipped).toBe(true);
    expect(me.onboardingComplete).toBe(true);
  });
});

describe("GitHub device flow via /api/me/github/device*", () => {
  it("device start surfaces the code from GitHub", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    const cookie = await cookieFor(ctx, app, "u1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          device_code: "dev1",
          user_code: "WXYZ-1",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      ),
    );
    const res = await app.request("/api/me/github/device", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const body = await bodyOf(res);
    expect(body.ok).toBe(true);
    expect(body.userCode).toBe("WXYZ-1");
    expect(body.deviceCode).toBe("dev1");
  });

  it("poll authorizes and links, resolving the login", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    const cookie = await cookieFor(ctx, app, "u1");
    const fetchMock = vi.fn(async (url: unknown) => {
      const href = String(url);
      if (href.includes("access_token")) {
        return jsonResponse(200, { access_token: "gho_x", expires_in: 28800 });
      }
      return jsonResponse(200, { login: "octocat" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/me/github/device/poll", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: "dev1" }),
    });
    const body = await bodyOf(res);
    expect(body.status).toBe("authorized");
    expect(body.login).toBe("octocat");
    expect(ctx.github.get("u1")?.login).toBe("octocat");
  });

  it("poll reports pending without linking anything", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    const cookie = await cookieFor(ctx, app, "u1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { error: "authorization_pending" })),
    );
    const res = await app.request("/api/me/github/device/poll", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: "dev1" }),
    });
    const body = await bodyOf(res);
    expect(body.status).toBe("pending");
    expect(ctx.github.get("u1")).toBeUndefined();
  });

  it("unlink only ever affects the caller's own github identity", async () => {
    const { ctx, app } = makeApp();
    await ctx.github.link("u1", { accessToken: "a1", expiresAt: null });
    await ctx.github.link("u2", { accessToken: "a2", expiresAt: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { login: "whoever" })),
    );
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/github", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.github.get("u1")).toBeUndefined();
    expect(ctx.github.get("u2")).toBeDefined();
  });
});
