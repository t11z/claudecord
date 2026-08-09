import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { SetupResultDto } from "../../types.js";

/**
 * The Discord bot token has no dashboard form: reaching this page at all
 * requires `/dashboard` to already work, which requires the bot to already
 * be online, which requires the token to already be in `.env`. See
 * `getting-started.md` for the bootstrap sequence.
 */
export function setupRoutes(app: Hono, ctx: AppContext): void {
  /**
   * Store (or clear) the GitHub App used for per-user Device Flow linking.
   * Env-provided GITHUB_APP_CLIENT_ID/_SECRET still take precedence.
   */
  app.post("/api/setup/github-app", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      clientId?: string;
      clientSecret?: string;
    };
    const clientId = body.clientId?.trim();
    const clientSecret = body.clientSecret?.trim();

    if (!clientId && !clientSecret) {
      ctx.secrets.update({ githubAppClientId: undefined, githubAppClientSecret: undefined });
      return c.json<SetupResultDto>({ ok: true, message: "GitHub App credentials removed." });
    }
    if (!clientId || !clientSecret) {
      return c.json<SetupResultDto>(
        { ok: false, message: "Both the Client ID and a Client secret are required." },
        400,
      );
    }
    ctx.secrets.update({ githubAppClientId: clientId, githubAppClientSecret: clientSecret });
    return c.json<SetupResultDto>({
      ok: true,
      message: "GitHub App saved. Role-gated users can now run /link-github to connect GitHub.",
    });
  });
}
