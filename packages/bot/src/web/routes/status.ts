import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import { publicUrl } from "../../discord/commands/dashboard.js";
import type { StatusDto } from "../../types.js";
import { redirectUri } from "../discord-oauth.js";

const BOT_PERMISSIONS = "397552861248"; // view/send/threads/embed/attach/react/history

export function buildInviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${BOT_PERMISSIONS}`;
}

export function statusRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/status", (c) => {
    const creds = ctx.credentials();
    const client = ctx.discord;
    const appId = creds.discordApplicationId ?? client?.user?.id ?? null;
    const dto: StatusDto = {
      ready: client?.isReady() ?? false,
      discordConnected: client?.isReady() ?? false,
      botUser: client?.user ? { id: client.user.id, tag: client.user.tag } : null,
      guildCount: client?.guilds.cache.size ?? 0,
      uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
      claudeIdentityCount: ctx.claude.list().length,
      githubAppConfigured: !!(creds.githubAppClientId && creds.githubAppClientSecret),
      discordOAuthConfigured: !!(
        creds.discordApplicationId &&
        creds.discordClientSecret &&
        ctx.env.DASHBOARD_PUBLIC_URL
      ),
      discordRedirectUri: ctx.env.DASHBOARD_PUBLIC_URL ? redirectUri(publicUrl(ctx.env)) : null,
      defaultModel: ctx.env.CLAUDE_MODEL,
      queueDepth: ctx.queue.depth,
      activeRuns: ctx.queue.activeRuns,
      inviteUrl: appId ? buildInviteUrl(appId) : null,
      version: ctx.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
    };
    return c.json(dto);
  });
}
