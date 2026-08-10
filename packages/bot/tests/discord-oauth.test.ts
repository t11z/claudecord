import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppContext, createContext } from "../src/context.js";
import { loadEnv } from "../src/env.js";
import { createLogger } from "../src/logger.js";
import { buildApiApp } from "../src/web/server.js";

/**
 * "Sign in with Discord" — the second door into the dashboard.
 *
 * The load-bearing assertions here are the ones about *authority*: the callback
 * learns who you are from Discord, but everything about what you may do comes
 * from the bot's own connection. In particular the admin bootstrap must not be
 * claimable by simply signing in.
 *
 * What these tests cannot cover: whether the browser sends the `SameSite=Strict`
 * cookie after the callback. `app.request()` has no cookie jar and no notion of
 * site. That is why the callback ends on a same-site page instead of a redirect,
 * and why it needs a real browser to confirm.
 */

const PUBLIC_URL = "https://dash.example.test";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudecord-oauth-test-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function makeApp(extraEnv: Record<string, string> = {}) {
  const env = loadEnv({
    DATA_DIR: dataDir,
    DISCORD_APPLICATION_ID: "app-1",
    DASHBOARD_PUBLIC_URL: PUBLIC_URL,
    ...extraEnv,
  });
  const ctx: AppContext = createContext(env, createLogger("silent"));
  return { ctx, app: buildApiApp(ctx, false) };
}

/** A guild the bot is in, where `userId` holds `roleIds` and maybe Manage Guild. */
function guild(id: string, userId: string, roleIds: string[], manageGuild = false) {
  const member = {
    roles: { cache: new Map(roleIds.map((r) => [r, { id: r }])) },
    permissions: { has: (flag: bigint) => manageGuild && flag === PermissionFlagsBits.ManageGuild },
  };
  return {
    id,
    name: `guild-${id}`,
    iconURL: () => null,
    members: {
      fetch: async (want: string) => {
        if (want !== userId) throw new Error("Unknown Member");
        return member;
      },
    },
  };
}

function fakeDiscord(...guilds: ReturnType<typeof guild>[]) {
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } } as unknown as Client;
}

/** Discord's two calls: token exchange, then /users/@me. */
function stubDiscordApi(profile: { id: string; username: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const href = String(url);
      const body = href.includes("oauth2/token")
        ? { access_token: "at-1" }
        : { id: profile.id, username: profile.username, global_name: null, avatar: null };
      return { ok: true, status: 200, headers: new Headers(), json: async () => body };
    }),
  );
}

function mintState(ctx: AppContext): string {
  return ctx.oauthState.mint({ kind: "discord-oauth" });
}

function callback(app: Hono, code: string, state: string) {
  return app.request(`/api/auth/discord/callback?code=${code}&state=${state}`);
}

describe("GET /api/auth/discord/start", () => {
  it("is refused when no client secret is configured", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/discord/start");
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/isn't set up/i);
  });

  it("is refused when there is no public URL for Discord to return to", async () => {
    // Built without DASHBOARD_PUBLIC_URL: the redirect URI would be a guessed
    // localhost that Discord rejects on its own page, invisible to the operator.
    const env = loadEnv({ DATA_DIR: dataDir, DISCORD_APPLICATION_ID: "app-1" });
    const ctx = createContext(env, createLogger("silent"));
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    const res = await buildApiApp(ctx, false).request("/api/auth/discord/start");
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/no public URL/i);
  });

  it("redirects to Discord with the identify scope and a signed state", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    const res = await app.request("/api/auth/discord/start");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("scope")).toBe("identify");
    expect(location.searchParams.get("client_id")).toBe("app-1");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${PUBLIC_URL}/api/auth/discord/callback`,
    );
    // The state must be our own signed token, not something guessable.
    expect(ctx.oauthState.peek(location.searchParams.get("state")!)).toEqual({
      kind: "discord-oauth",
    });
  });
});

describe("GET /api/auth/discord/callback", () => {
  it("rejects a missing, forged or replayed state", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(guild("g1", "u1", []));
    stubDiscordApi({ id: "u1", username: "alice" });

    expect((await app.request("/api/auth/discord/callback?code=c1")).status).toBe(400);
    expect((await callback(app, "c1", "forged")).status).toBe(400);

    const state = mintState(ctx);
    expect((await callback(app, "c1", state)).status).toBe(200); // first use works
    expect((await callback(app, "c1", state)).status).toBe(400); // replay refused
  });

  it("signs in and lands on a same-site page rather than a redirect", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(guild("g1", "u1", []));
    stubDiscordApi({ id: "u1", username: "alice" });

    const res = await callback(app, "c1", mintState(ctx));
    // Not a 303: a cross-site redirect risks the Strict cookie being withheld.
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("claudecord_sid=");
    expect(await res.text()).toContain('location.replace("/")');
    expect(ctx.repos.dashboardUsers.get("u1")?.username).toBe("alice");
  });

  it("refuses a user no mutual server admits", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(guild("g1", "u1", ["other"]));
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g1"),
      guildId: "g1",
      allowedRoleIds: ["allowed"],
    });
    stubDiscordApi({ id: "u1", username: "alice" });

    const res = await callback(app, "c1", mintState(ctx));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(ctx.repos.dashboardUsers.get("u1")).toBeUndefined();
  });

  it("fails closed while the bot is disconnected", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    stubDiscordApi({ id: "u1", username: "alice" });
    const res = await callback(app, "c1", mintState(ctx));
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("the admin bootstrap is not claimable by signing in", () => {
  it("does not grant admin without Manage Guild", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(guild("g1", "u1", [], false));
    stubDiscordApi({ id: "u1", username: "alice" });

    await callback(app, "c1", mintState(ctx));
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);
  });

  it("ignores Manage Guild in a server that doesn't admit the user", async () => {
    // The intersection that keeps this door no wider than /dashboard: holding
    // Manage Guild somewhere you aren't allowed to use the bot must not count.
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(
      guild("g-locked", "u1", ["other"], true), // Manage Guild, but not admitted
      guild("g-open", "u1", [], false), // admitted, but no Manage Guild
    );
    ctx.repos.guildConfig.upsert({
      ...ctx.repos.guildConfig.get("g-locked"),
      guildId: "g-locked",
      allowedRoleIds: ["allowed"],
    });
    stubDiscordApi({ id: "u1", username: "alice" });

    const res = await callback(app, "c1", mintState(ctx));
    expect(res.status).toBe(200); // g-open lets them in
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);
  });

  it("grants admin only when Manage Guild is held in an admitting server", async () => {
    const { ctx, app } = makeApp();
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(guild("g1", "u1", [], true));
    stubDiscordApi({ id: "u1", username: "alice" });

    await callback(app, "c1", mintState(ctx));
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(true);
  });

  it("DASHBOARD_ADMIN_IDS still disables the claim for everyone else", async () => {
    const { ctx, app } = makeApp({ DASHBOARD_ADMIN_IDS: "someone-else" });
    ctx.secrets.update({ discordClientSecret: "cs-1" });
    ctx.discord = fakeDiscord(guild("g1", "u1", [], true));
    stubDiscordApi({ id: "u1", username: "alice" });

    await callback(app, "c1", mintState(ctx));
    expect(ctx.repos.dashboardUsers.get("u1")?.isAdmin).toBe(false);
  });
});

describe("GET /api/auth/session advertises the button", () => {
  it("is false without a secret and true with one", async () => {
    const { ctx, app } = makeApp();
    const off = await (await app.request("/api/auth/session")).json();
    expect(off).toMatchObject({ discordOAuthConfigured: false });

    ctx.secrets.update({ discordClientSecret: "cs-1" });
    const on = await (await app.request("/api/auth/session")).json();
    expect(on).toMatchObject({ discordOAuthConfigured: true });
  });
});
