import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "discord.js";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../src/context.js";

/**
 * Exercises the migration wizard's real route wiring (server.ts), the same
 * way tests/me-routes.test.ts and tests/web-route-gating.test.ts do — Claude
 * claiming goes through the real engine (mocked like tests/runner.test.ts),
 * GitHub claiming goes through real `fetch` (stubbed like
 * tests/github-device-flow.test.ts).
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

function claudeAuthFail() {
  queryMock.mockReturnValue(
    sdkStream([
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["bad token"] },
    ]),
  );
}

function jsonResponse(status: number, body: unknown, headers = new Headers()) {
  return { ok: status >= 200 && status < 300, status, headers, json: async () => body };
}

// biome-ignore lint/suspicious/noExplicitAny: test helper for reading response bodies of varying shapes
async function bodyOf(res: Response): Promise<any> {
  return res.json();
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-migrate-test-"));
  queryMock.mockReset();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/** Seeds secrets.json with legacy keys before the SecretsStore ever loads it. */
function seedLegacySecrets(patch: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dataDir, "secrets.json"), JSON.stringify(patch), { mode: 0o600 });
}

function makeApp(): { ctx: AppContext; app: Hono } {
  const env = loadEnv({ DATA_DIR: dataDir });
  const ctx = createContext(env, createLogger("silent"));
  return { ctx, app: buildApiApp(ctx, false) };
}

async function adminCookie(ctx: AppContext, app: Hono, sub = "admin1"): Promise<string> {
  const token = ctx.magicLink.mint({
    sub,
    username: `user-${sub}`,
    globalName: null,
    avatarUrl: null,
    hasManageGuild: true,
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

function fakeDiscordWithMember(guildId: string, userId: string) {
  const member = {
    user: {
      username: "octo",
      globalName: "Octo Cat",
      avatarURL: () => "https://example.com/a.png",
    },
  };
  const guild = { members: { cache: new Map([[userId, member]]) } };
  return { guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
}

describe("GET /api/migrate/status", () => {
  it("needs nothing on a fresh install — already stamped by stampFreshInstall", async () => {
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);
    const res = await app.request("/api/migrate/status", { headers: { Cookie: cookie } });
    const body = await bodyOf(res);
    expect(body.needed).toBe(false);
  });

  it("is needed when a legacy secrets.json key is present", async () => {
    seedLegacySecrets({ claudeOauthToken: "legacy-tok" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);
    const res = await app.request("/api/migrate/status", { headers: { Cookie: cookie } });
    const body = await bodyOf(res);
    expect(body.needed).toBe(true);
    expect(body.legacy.claudeOauthToken).toBe(true);
    expect(body.legacy.githubToken).toBe(false);
  });

  it("requires an admin session", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/migrate/status")).status).toBe(401);
  });
});

describe("POST /api/migrate/claude/claim", () => {
  it("verifies, adopts as the caller's own identity, and clears the legacy key", async () => {
    seedLegacySecrets({ claudeOauthToken: "legacy-tok" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app, "admin1");
    claudeOk();

    const res = await app.request("/api/migrate/claude/claim", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.claude.getToken("admin1")).toBe("legacy-tok");
    expect(ctx.secrets.getLegacy("claudeOauthToken")).toBeUndefined();
  });

  it("leaves the legacy key in place when verification fails", async () => {
    seedLegacySecrets({ claudeOauthToken: "bad-tok" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app, "admin1");
    claudeAuthFail();

    const res = await app.request("/api/migrate/claude/claim", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
    expect(ctx.claude.getToken("admin1")).toBeNull();
    expect(ctx.secrets.getLegacy("claudeOauthToken")).toBe("bad-tok");
  });

  it("404s when there is nothing to claim", async () => {
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);
    const res = await app.request("/api/migrate/claude/claim", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/migrate/claude/discard and /api/migrate/api-key/discard", () => {
  it("clears the key without adopting it, and is idempotent", async () => {
    seedLegacySecrets({ claudeOauthToken: "t", anthropicApiKey: "sk-ant-api-x" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);

    await app.request("/api/migrate/claude/discard", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(ctx.secrets.getLegacy("claudeOauthToken")).toBeUndefined();
    expect(ctx.claude.list()).toHaveLength(0);

    const second = await app.request("/api/migrate/claude/discard", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(second.status).toBe(200);

    const apiKeyRes = await app.request("/api/migrate/api-key/discard", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(apiKeyRes.status).toBe(200);
    expect(ctx.secrets.getLegacy("anthropicApiKey")).toBeUndefined();
  });
});

describe("POST /api/migrate/github/claim and /discard", () => {
  it("verifies, adopts as the caller's own identity, and clears the legacy key", async () => {
    seedLegacySecrets({ githubToken: "legacy-gh-tok" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app, "admin1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { login: "octocat" })),
    );

    const res = await app.request("/api/migrate/github/claim", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.github.get("admin1")?.accessToken).toBe("legacy-gh-tok");
    expect(ctx.secrets.getLegacy("githubToken")).toBeUndefined();
  });

  it("discards without adopting", async () => {
    seedLegacySecrets({ githubToken: "legacy-gh-tok" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);
    const res = await app.request("/api/migrate/github/discard", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.secrets.getLegacy("githubToken")).toBeUndefined();
    expect(ctx.github.list()).toHaveLength(0);
  });

  it("an empty-string legacy token is treated as absent, not offered by /status", async () => {
    // Some upgraded installs' secrets.json carries `"githubToken": ""` from an
    // old deploy that set the env var to nothing. Before this was treated
    // consistently, /status reported it present (`!== undefined`) and the
    // wizard offered to adopt it, but /claim (correctly, via `if (!token)`)
    // 404ed — an admin saw an offer they could never actually take.
    seedLegacySecrets({ githubToken: "" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);

    const status = await app.request("/api/migrate/status", { headers: { Cookie: cookie } });
    expect((await bodyOf(status)).legacy.githubToken).toBe(false);

    const claim = await app.request("/api/migrate/github/claim", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(claim.status).toBe(404);
  });
});

describe("POST /api/migrate/password/discard", () => {
  it("clears the legacy password key", async () => {
    seedLegacySecrets({ dashboardPassword: "hunter2" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);
    const res = await app.request("/api/migrate/password/discard", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(ctx.secrets.getLegacy("dashboardPassword")).toBeUndefined();
  });
});

describe("POST /api/migrate/profiles/backfill", () => {
  it("resolves a profile for a linked user who never opened the dashboard", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("member1", "member-tok");
    ctx.discord = fakeDiscordWithMember("g1", "member1");

    const statusBefore = await app.request("/api/migrate/status", {
      headers: { Cookie: await adminCookie(ctx, app) },
    });
    expect((await bodyOf(statusBefore)).unresolvedProfiles).toEqual(["member1"]);

    const res = await app.request("/api/migrate/profiles/backfill", {
      method: "POST",
      headers: { Cookie: await adminCookie(ctx, app, "admin1") },
    });
    expect(res.status).toBe(200);
    expect(ctx.repos.dashboardUsers.get("member1")?.username).toBe("octo");
    expect(ctx.repos.dashboardUsers.get("member1")?.isAdmin).toBe(false);
  });
});

describe("POST /api/migrate/complete", () => {
  it("stamps migration_version so status flips to not-needed", async () => {
    seedLegacySecrets({ dashboardPassword: "hunter2" });
    const { ctx, app } = makeApp();
    const cookie = await adminCookie(ctx, app);

    expect(
      (await bodyOf(await app.request("/api/migrate/status", { headers: { Cookie: cookie } })))
        .needed,
    ).toBe(true);

    await app.request("/api/migrate/complete", { method: "POST", headers: { Cookie: cookie } });

    const after = await app.request("/api/migrate/status", { headers: { Cookie: cookie } });
    expect((await bodyOf(after)).needed).toBe(false);
  });
});
