import type { GuildMember } from "discord.js";
import type { Hono } from "hono";
import { checkClaudeAuth } from "../../claude/auth-check.js";
import type { AppContext } from "../../context.js";
import { checkGithubToken } from "../../github/verify.js";
import {
  CURRENT_MIGRATION_VERSION,
  hasPriorState,
  MIGRATION_VERSION_KEY,
} from "../../migration.js";
import type { MigrationStatusDto, SetupResultDto } from "../../types.js";

/** Discord user ids with a linked Claude/GitHub identity but no dashboard profile yet. */
function unresolvedProfiles(ctx: AppContext): string[] {
  const linked = new Set<string>();
  for (const identity of ctx.claude.list()) linked.add(identity.discordUserId);
  for (const identity of ctx.github.list()) linked.add(identity.discordUserId);
  return [...linked].filter((id) => !ctx.repos.dashboardUsers.get(id));
}

/**
 * Walks an admin through what the old instance-wide credential model left in
 * secrets.json: claim it as your own /link-claude or /link-github identity,
 * or discard it, plus a one-off backfill of display profiles for users who
 * linked in Discord but never opened the dashboard. Mounted behind the
 * dashboard admin gate (server.ts) — these are instance-wide secrets, so
 * only an admin should decide their fate.
 */
export function migrateRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/migrate/status", (c) => {
    const dto: MigrationStatusDto = {
      needed: ctx.repos.appConfig.get(MIGRATION_VERSION_KEY) === undefined && hasPriorState(ctx),
      legacy: {
        claudeOauthToken: ctx.secrets.getLegacy("claudeOauthToken") !== undefined,
        anthropicApiKey: ctx.secrets.getLegacy("anthropicApiKey") !== undefined,
        githubToken: ctx.secrets.getLegacy("githubToken") !== undefined,
        dashboardPassword: ctx.secrets.getLegacy("dashboardPassword") !== undefined,
      },
      unresolvedProfiles: unresolvedProfiles(ctx),
    };
    return c.json(dto);
  });

  /** Verifies the legacy Claude token and adopts it as the caller's own /link-claude identity. */
  app.post("/api/migrate/claude/claim", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const token = ctx.secrets.getLegacy("claudeOauthToken");
    if (!token) {
      return c.json<SetupResultDto>({ ok: false, message: "No legacy token found." }, 404);
    }
    const check = await checkClaudeAuth(ctx.engine, token);
    if (!check.ok) {
      return c.json<SetupResultDto>({ ok: false, message: check.message }, 400);
    }
    ctx.claude.link(session.sub, token);
    ctx.secrets.deleteLegacyKeys(["claudeOauthToken"]);
    return c.json<SetupResultDto>({ ok: true, message: "Adopted as your Claude subscription." });
  });

  app.post("/api/migrate/claude/discard", (c) => {
    ctx.secrets.deleteLegacyKeys(["claudeOauthToken"]);
    return c.json<SetupResultDto>({ ok: true, message: "Discarded." });
  });

  /** No adoption path — a subscription OAuth token can't come from an API key. */
  app.post("/api/migrate/api-key/discard", (c) => {
    ctx.secrets.deleteLegacyKeys(["anthropicApiKey"]);
    return c.json<SetupResultDto>({ ok: true, message: "Discarded." });
  });

  /** Verifies the legacy GitHub token and adopts it as the caller's own /link-github identity. */
  app.post("/api/migrate/github/claim", async (c) => {
    const session = ctx.auth.getSession(c)!;
    const token = ctx.secrets.getLegacy("githubToken");
    if (!token) {
      return c.json<SetupResultDto>({ ok: false, message: "No legacy token found." }, 404);
    }
    const check = await checkGithubToken(token);
    if (!check.ok) {
      return c.json<SetupResultDto>({ ok: false, message: check.message }, 400);
    }
    await ctx.github.link(session.sub, {
      accessToken: token,
      refreshToken: undefined,
      expiresAt: null,
    });
    ctx.secrets.deleteLegacyKeys(["githubToken"]);
    return c.json<SetupResultDto>({
      ok: true,
      message: `Adopted as ${check.login ?? "your GitHub account"}.`,
    });
  });

  app.post("/api/migrate/github/discard", (c) => {
    ctx.secrets.deleteLegacyKeys(["githubToken"]);
    return c.json<SetupResultDto>({ ok: true, message: "Discarded." });
  });

  app.post("/api/migrate/password/discard", (c) => {
    ctx.secrets.deleteLegacyKeys(["dashboardPassword"]);
    return c.json<SetupResultDto>({ ok: true, message: "Discarded." });
  });

  /** Resolves display profiles, from the bot's member cache, for linked users who never signed in. */
  app.post("/api/migrate/profiles/backfill", (c) => {
    let resolved = 0;
    for (const id of unresolvedProfiles(ctx)) {
      let member: GuildMember | undefined;
      for (const guild of ctx.discord?.guilds.cache.values() ?? []) {
        member = guild.members.cache.get(id);
        if (member) break;
      }
      if (!member) continue;
      ctx.repos.dashboardUsers.backfillProfile({
        discordUserId: id,
        username: member.user.username,
        globalName: member.user.globalName ?? null,
        avatarUrl: member.user.avatarURL({ size: 64 }),
        now: new Date().toISOString(),
      });
      resolved++;
    }
    return c.json<SetupResultDto>({ ok: true, message: `Resolved ${resolved} profile(s).` });
  });

  app.post("/api/migrate/complete", (c) => {
    ctx.repos.appConfig.set(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION);
    return c.json({ ok: true });
  });
}
