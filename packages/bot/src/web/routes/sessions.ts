import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { SessionDto } from "../../types.js";

export function sessionRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/sessions", (c) => {
    const sessions: SessionDto[] = ctx.repos.sessions.list().map((s) => {
      const channel = ctx.discord?.channels.cache.get(s.threadId);
      return {
        threadId: s.threadId,
        guildId: s.guildId,
        channelId: s.channelId,
        claudeSessionId: s.claudeSessionId,
        threadName: channel && "name" in channel ? (channel.name ?? null) : null,
        model: s.model,
        mode: s.mode,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        turnCount: s.turnCount,
        running: ctx.activeRuns.has(s.threadId),
      };
    });
    return c.json(sessions);
  });

  app.delete("/api/sessions/:threadId", (c) => {
    const threadId = c.req.param("threadId");
    ctx.activeRuns.get(threadId)?.abort();
    const deleted = ctx.repos.sessions.delete(threadId);
    return c.json({ ok: deleted });
  });

  app.post("/api/sessions/:threadId/abort", (c) => {
    const threadId = c.req.param("threadId");
    const controller = ctx.activeRuns.get(threadId);
    if (!controller) return c.json({ ok: false, error: "not running" }, 404);
    controller.abort();
    return c.json({ ok: true });
  });
}
