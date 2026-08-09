import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { GuildSummaryDto } from "../../types.js";

/**
 * The full guild list, instance-wide — admin-only (registered in the
 * blanket-gated group in server.ts). Per-guild config lives in
 * guild-config.ts, gated separately so a non-admin server manager can reach
 * just their own guild.
 */
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
}
