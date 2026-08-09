import type { Client } from "discord.js";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { openMemoryDatabase } from "../src/db/database.js";
import { AppConfigRepo } from "../src/db/repos/app-config.js";
import { DashboardAuth } from "../src/web/auth.js";
import { requireGuildManager } from "../src/web/middleware.js";

/**
 * Minimal fake of the one discord.js surface requireGuildManager touches:
 * ctx.discord.guilds.cache.get(id).members.fetch(userId).permissions.has(flag).
 * A single-member fetch by id needs no privileged Guild Members intent, so
 * this shape is exactly what production code calls.
 */
function fakeDiscord(guildId: string, opts: { hasManageGuild?: boolean; isMember?: boolean } = {}) {
  const { hasManageGuild = false, isMember = true } = opts;
  const guild = {
    members: {
      fetch: async () => {
        if (!isMember) throw new Error("Unknown Member");
        return { permissions: { has: () => hasManageGuild } };
      },
    },
  };
  return { guilds: { cache: new Map([[guildId, guild]]) } } as unknown as Client;
}

function makeCtx(discord: Client | null) {
  const db = openMemoryDatabase();
  const auth = new DashboardAuth(new AppConfigRepo(db));
  return { auth, discord } as unknown as import("../src/context.js").AppContext;
}

async function mintCookie(auth: DashboardAuth, isAdmin: boolean): Promise<string> {
  const mini = new Hono();
  mini.get("/set", (c) => {
    auth.issueCookie(c, { sub: "u1", isAdmin });
    return c.text("ok");
  });
  const res = await mini.request("/set");
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function appFor(ctx: import("../src/context.js").AppContext) {
  const app = new Hono();
  app.get("/api/guilds/:id/config", requireGuildManager(ctx), (c) => c.text("ok"));
  return app;
}

describe("requireGuildManager", () => {
  it("401s with no session", async () => {
    const ctx = makeCtx(fakeDiscord("g1", { hasManageGuild: true }));
    const res = await appFor(ctx).request("/api/guilds/g1/config");
    expect(res.status).toBe(401);
  });

  it("an admin session passes regardless of guild membership", async () => {
    const ctx = makeCtx(fakeDiscord("g1", { isMember: false }));
    const cookie = await mintCookie(ctx.auth, true);
    const res = await appFor(ctx).request("/api/guilds/g1/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  it("a non-admin member WITH Manage Guild on that guild passes", async () => {
    const ctx = makeCtx(fakeDiscord("g1", { hasManageGuild: true }));
    const cookie = await mintCookie(ctx.auth, false);
    const res = await appFor(ctx).request("/api/guilds/g1/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  it("a non-admin member WITHOUT Manage Guild on that guild is 403'd", async () => {
    const ctx = makeCtx(fakeDiscord("g1", { hasManageGuild: false }));
    const cookie = await mintCookie(ctx.auth, false);
    const res = await appFor(ctx).request("/api/guilds/g1/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });

  it("a non-admin who isn't a member of that guild at all is 403'd", async () => {
    const ctx = makeCtx(fakeDiscord("g1", { isMember: false }));
    const cookie = await mintCookie(ctx.auth, false);
    const res = await appFor(ctx).request("/api/guilds/g1/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });

  it("a non-admin is 403'd when the bot isn't connected at all", async () => {
    const ctx = makeCtx(null);
    const cookie = await mintCookie(ctx.auth, false);
    const res = await appFor(ctx).request("/api/guilds/g1/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });

  it("Manage Guild on a DIFFERENT guild than the one being edited does not grant access", async () => {
    const ctx = makeCtx(fakeDiscord("g2", { hasManageGuild: true })); // only g2 is known
    const cookie = await mintCookie(ctx.auth, false);
    const res = await appFor(ctx).request("/api/guilds/g1/config", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
});
