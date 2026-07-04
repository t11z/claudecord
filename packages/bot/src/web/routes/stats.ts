import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { StatsDto } from "../../types.js";

export function statsRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/stats", (c) => {
    const windowDays = Math.min(
      Math.max(Number.parseInt(c.req.query("window") ?? "30", 10) || 30, 1),
      365,
    );
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const totals = ctx.repos.usage.totalsSince(since);
    const dto: StatsDto = {
      windowDays,
      totalRuns: totals.runs,
      totalErrors: totals.errors,
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalCostUsd: totals.costUsd,
      daily: ctx.repos.usage.dailySince(since),
      topGuilds: ctx.repos.usage.topGuildsSince(since).map((g) => ({
        guildId: g.guildId,
        guildName: ctx.discord?.guilds.cache.get(g.guildId)?.name ?? null,
        runs: g.runs,
      })),
      topUsers: ctx.repos.usage.topUsersSince(since).map((u) => ({
        userId: u.userId,
        runs: u.runs,
      })),
      lastRateLimitAt: ctx.repos.usage.lastRateLimitAt(),
      recentErrors: ctx.repos.usage.recentErrorsSince(since).map((e) => ({
        ...e,
        guildName: ctx.discord?.guilds.cache.get(e.guildId)?.name ?? null,
      })),
    };
    return c.json(dto);
  });
}
