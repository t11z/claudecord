import { ChannelType } from "discord.js";
import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { GuildConfigDto, GuildConfigResponseDto, GuildSummaryDto } from "../../types.js";

export function configRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/guilds", (c) => {
    const guilds: GuildSummaryDto[] =
      ctx.discord?.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        iconUrl: g.iconURL({ size: 64 }),
        memberCount: g.memberCount ?? null,
      })) ?? [];
    return c.json(guilds);
  });

  app.get("/api/guilds/:id/config", (c) => {
    const guildId = c.req.param("id");
    const guild = ctx.discord?.guilds.cache.get(guildId);
    const config = ctx.repos.guildConfig.get(guildId);
    const dto: GuildConfigResponseDto = {
      config: {
        guildId: config.guildId,
        enabled: config.enabled,
        allowedChannelIds: config.allowedChannelIds,
        allowedRoleIds: config.allowedRoleIds,
        agenticEnabled: config.agenticEnabled,
        githubRoleIds: config.githubRoleIds,
        model: config.model,
        systemPromptExtra: config.systemPromptExtra,
      },
      channels:
        guild?.channels.cache
          .filter(
            (ch) => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement,
          )
          .map((ch) => ({ id: ch.id, name: ch.name })) ?? [],
      roles:
        guild?.roles.cache
          .filter((r) => r.id !== guildId)
          .map((r) => ({
            id: r.id,
            name: r.name,
            color: r.hexColor === "#000000" ? null : r.hexColor,
          })) ?? [],
    };
    return c.json(dto);
  });

  app.put("/api/guilds/:id/config", async (c) => {
    const guildId = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Partial<GuildConfigDto> | null;
    if (!body) return c.json({ error: "invalid body" }, 400);

    const current = ctx.repos.guildConfig.get(guildId);
    ctx.repos.guildConfig.upsert({
      guildId,
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      allowedChannelIds: Array.isArray(body.allowedChannelIds)
        ? body.allowedChannelIds.filter((v): v is string => typeof v === "string")
        : current.allowedChannelIds,
      allowedRoleIds: Array.isArray(body.allowedRoleIds)
        ? body.allowedRoleIds.filter((v): v is string => typeof v === "string")
        : current.allowedRoleIds,
      agenticEnabled:
        typeof body.agenticEnabled === "boolean" ? body.agenticEnabled : current.agenticEnabled,
      githubRoleIds: Array.isArray(body.githubRoleIds)
        ? body.githubRoleIds.filter((v): v is string => typeof v === "string")
        : current.githubRoleIds,
      model: body.model !== undefined ? body.model : current.model,
      systemPromptExtra:
        body.systemPromptExtra !== undefined ? body.systemPromptExtra : current.systemPromptExtra,
    });
    return c.json({ ok: true });
  });
}
