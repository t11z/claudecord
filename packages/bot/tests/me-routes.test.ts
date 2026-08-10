import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "discord.js";
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

/**
 * A Discord client where `userId` is a member of one guild holding `roleIds`.
 * Shaped like `fakeDiscordWithMember` in tests/migrate.test.ts, plus the role
 * cache the GitHub link gate reads. Without this, `ctx.discord` is null and the
 * gate correctly refuses (503) — see `checkGithubLinkEligibility`.
 */
function fakeDiscordWithRoles(guildId: string, userId: string, roleIds: string[]) {
  const member = { roles: { cache: new Map(roleIds.map((r) => [r, { id: r }])) } };
  const guild = {
    id: guildId,
    name: "Test Guild",
    iconURL: () => null,
    members: {
      fetch: async (id: string) => (id === userId ? member : Promise.reject(new Error())),
    },
  };
  return { guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
}

/** A connected client that shares no guild with anyone — for the "no mutual server" case. */
function fakeDiscordNoGuilds() {
  return { guilds: { cache: new Map() } } as unknown as Client;
}

/**
 * Two guilds: the first's `members.fetch` rejects (rate limit / network / left
 * the server), the second grants `roleIds`. Proves the walk keeps going instead
 * of failing the whole request on one bad guild.
 */
function fakeDiscordFirstGuildThrows(userId: string, roleIds: string[]) {
  const ok = { roles: { cache: new Map(roleIds.map((r) => [r, { id: r }])) } };
  const broken = {
    id: "g-broken",
    name: "Broken",
    iconURL: () => null,
    members: {
      fetch: async () => {
        throw new Error("429 rate limited");
      },
    },
  };
  const good = {
    id: "g-good",
    name: "Good",
    iconURL: () => null,
    members: { fetch: async (id: string) => (id === userId ? ok : Promise.reject(new Error())) },
  };
  return {
    guilds: {
      cache: new Map([
        ["g-broken", broken],
        ["g-good", good],
      ]),
    },
  } as unknown as Client;
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

/**
 * An admin session for `sub`. `cookieFor` above always yields a NON-admin
 * (it mints `hasManageGuild: false`, which `decideIsAdmin` turns into
 * `isAdmin: false`), so every other test in this file runs as a member — which
 * is exactly why nothing caught that admins had no way to reach these routes.
 */
async function adminCookieFor(ctx: AppContext, sub: string): Promise<string> {
  const mini = new (await import("hono")).Hono();
  mini.get("/set", (c) => {
    ctx.auth.issueCookie(c, { sub, isAdmin: true });
    return c.text("ok");
  });
  const raw = (await mini.request("/set")).headers.get("set-cookie");
  if (!raw) throw new Error("no set-cookie header");
  return raw.split(";")[0]!;
}

describe("/api/me/* is reachable by an ADMIN session, not just a member", () => {
  it("lets an admin link their own Claude subscription", async () => {
    // The dashboard's "Your account" page for admins stands on this: requireUser
    // admits any signed-in user, admin included. Nothing pinned that before.
    const { ctx, app } = makeApp();
    const cookie = await adminCookieFor(ctx, "admin1");
    claudeOk();

    const res = await app.request("/api/me/claude", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sk-ant-oat01-real" }),
    });
    expect(res.status).toBe(200);
    expect(ctx.claude.getToken("admin1")).toBe("sk-ant-oat01-real");

    // …and it is the admin's own identity, visible on their own /api/me.
    const me = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(me.claude.linked).toBe(true);
    expect(me.user.id).toBe("admin1");
  });

  it("lets an admin read and unlink their own identity", async () => {
    const { ctx, app } = makeApp();
    const cookie = await adminCookieFor(ctx, "admin1");
    ctx.claude.link("admin1", "sk-ant-oat01-x");

    expect((await app.request("/api/me", { headers: { Cookie: cookie } })).status).toBe(200);
    const res = await app.request("/api/me/claude", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.claude.get("admin1")).toBeUndefined();
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

  it("reports appConfigured from the GitHub App credentials", async () => {
    const { ctx, app } = makeApp();
    const cookie = await cookieFor(ctx, app, "u1");
    expect(
      (await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }))).github
        .appConfigured,
    ).toBe(false);

    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    expect(
      (await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }))).github
        .appConfigured,
    ).toBe(true);
  });

  it("linkBlockedReason and per-guild githubAllowed mirror the role gate", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordWithRoles("g1", "u1", ["other-role"]);
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g1"),
      guildId: "g1",
      allowedRoleIds: ["gh-allowed"],
    });
    const cookie = await cookieFor(ctx, app, "u1");
    const denied = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(denied.github.linkBlockedReason).toMatch(/role that's allowed/i);
    expect(denied.guilds).toHaveLength(1);
    expect(denied.guilds[0].githubAllowed).toBe(false);

    ctx.discord = fakeDiscordWithRoles("g1", "u1", ["gh-allowed"]);
    const allowed = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(allowed.github.linkBlockedReason).toBeNull();
    expect(allowed.guilds[0].githubAllowed).toBe(true);
  });

  it("with no gate configured, every mutual guild allows linking", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordWithRoles("g1", "u1", []);
    const cookie = await cookieFor(ctx, app, "u1");
    const body = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(body.github.linkBlockedReason).toBeNull();
    expect(body.guilds[0].githubAllowed).toBe(true);
  });

  it("blames the missing GitHub App before anything else", async () => {
    const { ctx, app } = makeApp();
    ctx.discord = fakeDiscordWithRoles("g1", "u1", []);
    const cookie = await cookieFor(ctx, app, "u1");
    const body = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(body.github.linkBlockedReason).toMatch(/no GitHub App configured/i);
  });

  it("says Discord is unreachable — not 'wrong role' — while the bot is disconnected", async () => {
    // The regression this field exists for: with ctx.discord null the guild walk
    // is empty, and a naive `mayLink: false` would have made the UI claim the
    // user lacks a role, which is not true.
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    const cookie = await cookieFor(ctx, app, "u1");
    const body = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(body.github.linkBlockedReason).toMatch(/connected to Discord/i);
    // It may mention roles ("can't check your roles"), but must never blame the
    // user for lacking one — that's the misleading claim this field prevents.
    expect(body.github.linkBlockedReason).not.toMatch(/don't have a role/i);
  });

  it("says there's no mutual server when connected but sharing none", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordNoGuilds();
    const cookie = await cookieFor(ctx, app, "u1");
    const body = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(body.github.linkBlockedReason).toMatch(/don't share a server/i);
  });

  it("exposes claude.linkedAt once linked", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("u1", "sk-ant-oat01-x");
    const cookie = await cookieFor(ctx, app, "u1");
    const body = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(body.claude.linkedAt).toEqual(expect.any(String));
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
    ctx.discord = fakeDiscordWithRoles("g1", "u1", []);
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
    ctx.discord = fakeDiscordWithRoles("g1", "u1", []);
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

  it("device start is refused 503 when the bot isn't connected to Discord", async () => {
    // ctx.discord stays null — roles are unreadable, so the honest answer is
    // "not now", never a role complaint that isn't true.
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/github/device", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(503);
    expect((await bodyOf(res)).message).toMatch(/connected to Discord/i);
  });

  it("device start is refused 403 when no mutual server exists", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordNoGuilds();
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/github/device", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).message).toMatch(/don't share a server/i);
  });

  it("device start is refused 403 when the guild role gate excludes the user", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordWithRoles("g1", "u1", ["other-role"]);
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g1"),
      guildId: "g1",
      allowedRoleIds: ["gh-allowed"],
    });
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/github/device", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).message).toMatch(/role that's allowed/i);
  });

  it("one guild failing its member fetch doesn't stop the others being checked", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordFirstGuildThrows("u1", ["gh-allowed"]);
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g-good"),
      guildId: "g-good",
      allowedRoleIds: ["gh-allowed"],
    });
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
    // The broken guild is skipped, the good one grants — and no 500 escaped.
    expect(res.status).toBe(200);
    const me = await bodyOf(await app.request("/api/me", { headers: { Cookie: cookie } }));
    expect(me.guilds).toHaveLength(1);
    expect(me.guilds[0].id).toBe("g-good");
  });

  it("device start passes when the user holds the gated role in one server", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordWithRoles("g1", "u1", ["gh-allowed"]);
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g1"),
      guildId: "g1",
      allowedRoleIds: ["gh-allowed"],
    });
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
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).ok).toBe(true);
  });

  it("the poll that authorizes is gated too — an excluded user cannot store an identity", async () => {
    // The load-bearing check: the deviceCode carries no guild info, so gating
    // only the start would be bypassable by calling poll directly.
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    ctx.discord = fakeDiscordWithRoles("g1", "u1", ["other-role"]);
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g1"),
      guildId: "g1",
      allowedRoleIds: ["gh-allowed"],
    });
    const cookie = await cookieFor(ctx, app, "u1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("access_token")
          ? jsonResponse(200, { access_token: "gho_x", expires_in: 28800 })
          : jsonResponse(200, { login: "octocat" }),
      ),
    );
    const res = await app.request("/api/me/github/device/poll", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: "dev1" }),
    });
    expect(res.status).toBe(403);
    expect(ctx.github.get("u1")).toBeUndefined();
  });

  it("a pending poll does not re-check eligibility — no members.fetch storm", async () => {
    // Poll runs every ~5s for up to 900s. Checking the gate on every pending
    // poll would mean a members.fetch per guild each time, against a
    // rate-limited API. The gate belongs on the terminal poll only.
    const { ctx, app } = makeApp();
    ctx.secrets.update({ githubAppClientId: "cid", githubAppClientSecret: "csecret" });
    const memberFetch = vi.fn(async () => ({ roles: { cache: new Map() } }));
    ctx.discord = {
      guilds: {
        cache: new Map([
          ["g1", { id: "g1", name: "G", iconURL: () => null, members: { fetch: memberFetch } }],
        ]),
      },
    } as unknown as Client;
    const cookie = await cookieFor(ctx, app, "u1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { error: "authorization_pending" })),
    );
    for (let i = 0; i < 3; i++) {
      await app.request("/api/me/github/device/poll", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: "dev1" }),
      });
    }
    expect(memberFetch).not.toHaveBeenCalled();
  });

  it("unlink stays possible even when the role gate now excludes the user", async () => {
    const { ctx, app } = makeApp();
    await ctx.github.link("u1", { accessToken: "a1", expiresAt: null });
    ctx.discord = fakeDiscordWithRoles("g1", "u1", ["other-role"]);
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g1"),
      guildId: "g1",
      allowedRoleIds: ["gh-allowed"],
    });
    const cookie = await cookieFor(ctx, app, "u1");
    const res = await app.request("/api/me/github", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.github.get("u1")).toBeUndefined();
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
