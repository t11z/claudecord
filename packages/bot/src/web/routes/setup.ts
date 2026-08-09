import type { Hono } from "hono";
import type { AppContext } from "../../context.js";
import type { SetupResultDto } from "../../types.js";
import type { WebServerHooks } from "../server.js";

export function setupRoutes(app: Hono, ctx: AppContext, hooks: WebServerHooks): void {
  /** Store the Discord bot token and try to connect immediately. */
  app.post("/api/setup/discord-token", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: string;
      applicationId?: string;
    };
    const token = body.token?.trim();
    if (!token) return c.json<SetupResultDto>({ ok: false, message: "Token is empty." }, 400);

    ctx.secrets.update({
      discordBotToken: token,
      ...(body.applicationId?.trim() ? { discordApplicationId: body.applicationId.trim() } : {}),
    });

    const error = await hooks.onDiscordTokenSaved();
    if (error) {
      return c.json<SetupResultDto>({ ok: false, message: error }, 400);
    }
    return c.json<SetupResultDto>({
      ok: true,
      message:
        "Connected to Discord. Use the invite link on the overview page to add the bot to a server.",
    });
  });

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
