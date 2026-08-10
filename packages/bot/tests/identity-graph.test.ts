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
 * `GET /api/identity-graph` is the admin "Verknüpfungen" view's data: the union
 * of both identity stores joined to dashboard profiles. Exercised through the
 * real app wiring so the admin gate is covered too.
 */

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-graph-test-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeApp(): { ctx: AppContext; app: Hono } {
  const env = loadEnv({ DATA_DIR: dataDir });
  const ctx = createContext(env, createLogger("silent"));
  return { ctx, app: buildApiApp(ctx, false) };
}

async function adminCookie(ctx: AppContext): Promise<string> {
  const mini = new Hono();
  mini.get("/set", (c) => {
    ctx.auth.issueCookie(c, { sub: "admin1", isAdmin: true });
    return c.text("ok");
  });
  const raw = (await mini.request("/set")).headers.get("set-cookie");
  if (!raw) throw new Error("no set-cookie header");
  return raw.split(";")[0]!;
}

// biome-ignore lint/suspicious/noExplicitAny: test helper for reading response bodies
async function bodyOf(res: Response): Promise<any> {
  return res.json();
}

describe("GET /api/identity-graph", () => {
  it("requires an admin session", async () => {
    const { ctx, app } = makeApp();
    expect((await app.request("/api/identity-graph")).status).toBe(401);

    const mini = new Hono();
    mini.get("/set", (c) => {
      ctx.auth.issueCookie(c, { sub: "member1", isAdmin: false });
      return c.text("ok");
    });
    const raw = (await mini.request("/set")).headers.get("set-cookie")!;
    const res = await app.request("/api/identity-graph", {
      headers: { Cookie: raw.split(";")[0]! },
    });
    expect(res.status).toBe(403);
  });

  it("is empty when nobody has linked anything", async () => {
    const { ctx, app } = makeApp();
    const res = await app.request("/api/identity-graph", {
      headers: { Cookie: await adminCookie(ctx) },
    });
    expect((await bodyOf(res)).rows).toEqual([]);
  });

  it("unions both stores — a Claude-only and a GitHub-only user both appear", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("u-claude", "sk-ant-oat01-x");
    await ctx.github.link("u-github", { accessToken: "gho_x", expiresAt: null });

    const res = await app.request("/api/identity-graph", {
      headers: { Cookie: await adminCookie(ctx) },
    });
    const rows = (await bodyOf(res)).rows as {
      discordUserId: string;
      claude: { linked: boolean };
      github: { linked: boolean };
    }[];
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.discordUserId, r]));
    expect(byId.get("u-claude")?.claude.linked).toBe(true);
    expect(byId.get("u-claude")?.github.linked).toBe(false);
    expect(byId.get("u-github")?.github.linked).toBe(true);
    expect(byId.get("u-github")?.claude.linked).toBe(false);
  });

  it("a user linked only through Discord has no profile — display fields are null", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("never-signed-in", "sk-ant-oat01-x");
    const res = await app.request("/api/identity-graph", {
      headers: { Cookie: await adminCookie(ctx) },
    });
    const row = (await bodyOf(res)).rows[0];
    expect(row.discordUserId).toBe("never-signed-in");
    expect(row.username).toBeNull();
    expect(row.globalName).toBeNull();
    expect(row.avatarUrl).toBeNull();
  });

  it("never projects a token", async () => {
    const { ctx, app } = makeApp();
    ctx.claude.link("u1", "sk-ant-oat01-SECRET");
    await ctx.github.link("u1", { accessToken: "gho_SECRET", expiresAt: null });
    const res = await app.request("/api/identity-graph", {
      headers: { Cookie: await adminCookie(ctx) },
    });
    const raw = JSON.stringify(await bodyOf(res));
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("accessToken");
    expect(raw).not.toContain("oauthToken");
  });
});
