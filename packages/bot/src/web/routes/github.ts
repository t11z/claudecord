import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import { revokeUserToken } from "../../github/refresh.js";
import type { GithubIdentitiesResponseDto } from "../../types.js";

/**
 * Admin overview of per-user GitHub links. Read + unlink only — actual linking
 * happens in Discord via /link-github, since it needs the Discord user's
 * identity and role. Mounted behind the dashboard auth middleware.
 */
export function githubRoutes(app: Hono, ctx: AppContext): void {
  app.get("/api/github/identities", (c) => {
    const creds = ctx.credentials();
    const dto: GithubIdentitiesResponseDto = {
      appConfigured: !!(creds.githubAppClientId && creds.githubAppClientSecret),
      identities: ctx.github.list(),
    };
    return c.json(dto);
  });

  app.delete("/api/github/identities/:id", async (c) => {
    const id = c.req.param("id");
    const identity = ctx.github.get(id);
    if (identity) {
      const creds = ctx.credentials();
      if (creds.githubAppClientId && creds.githubAppClientSecret) {
        await revokeUserToken(
          creds.githubAppClientId,
          creds.githubAppClientSecret,
          identity.accessToken,
        );
      }
    }
    return c.json({ ok: ctx.github.unlink(id) });
  });
}
