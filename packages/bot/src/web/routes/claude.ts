import type { Hono } from "hono";
import { checkClaudeAuth } from "../../claude/auth-check.js";
import type { AppContext } from "../../context.js";
import type { ClaudeIdentitiesResponseDto, SetupResultDto } from "../../types.js";

/**
 * Admin overview of per-user Claude links. Read + unlink + re-check only —
 * actual linking happens in Discord via /link-claude, since the token is
 * entered through a modal that never touches a channel. Mounted behind the
 * dashboard auth middleware.
 */
export function claudeRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/claude/identities", (c) => {
    const dto: ClaudeIdentitiesResponseDto = { identities: ctx.claude.list() };
    return c.json(dto);
  });

  app.delete("/api/claude/identities/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ ok: ctx.claude.unlink(id) });
  });

  /** Re-run the auth check for one user's stored token and update lastVerifiedAt. */
  app.post("/api/claude/identities/:id/check", async (c) => {
    const id = c.req.param("id");
    const identity = ctx.claude.get(id);
    if (!identity) {
      return c.json<SetupResultDto>(
        { ok: false, message: "No linked identity for this user." },
        404,
      );
    }
    const check = await checkClaudeAuth(ctx.engine, identity.oauthToken);
    if (check.ok) ctx.claude.markVerified(id);
    return c.json<SetupResultDto>({ ok: check.ok, message: check.message }, check.ok ? 200 : 400);
  });
}
