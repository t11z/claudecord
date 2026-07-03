import type { Hono } from "hono";
import { checkClaudeAuth } from "../../claude/auth-check.js";
import type { AppContext } from "../../context.js";
import { checkGithubToken } from "../../github/verify.js";
import type { SetupResultDto } from "../../types.js";
import type { WebServerHooks } from "../server.js";

export function setupRoutes(app: Hono, ctx: AppContext, hooks: WebServerHooks): void {
  /**
   * Validate + store a Claude credential. OAuth tokens start with
   * "sk-ant-oat", API keys with "sk-ant-api" — we accept both and store
   * them in the right slot.
   */
  app.post("/api/setup/claude-token", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim();
    if (!token) return c.json<SetupResultDto>({ ok: false, message: "Token is empty." }, 400);

    if (token.startsWith("sk-ant-api")) {
      ctx.secrets.update({ anthropicApiKey: token, claudeOauthToken: undefined });
    } else {
      ctx.secrets.update({ claudeOauthToken: token, anthropicApiKey: undefined });
    }

    const check = await checkClaudeAuth(ctx.engine);
    ctx.authValid = check.ok;
    return c.json<SetupResultDto>({ ok: check.ok, message: check.message }, check.ok ? 200 : 400);
  });

  /** Re-run the Claude auth check with current credentials. */
  app.post("/api/setup/check-auth", async (c) => {
    if (ctx.credentials().authMethod === "none") {
      ctx.authValid = false;
      return c.json<SetupResultDto>(
        { ok: false, message: "No Claude credential configured." },
        400,
      );
    }
    const check = await checkClaudeAuth(ctx.engine);
    ctx.authValid = check.ok;
    return c.json<SetupResultDto>({ ok: check.ok, message: check.message }, check.ok ? 200 : 400);
  });

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
   * Store (or clear, with an empty token) the GitHub token. An env-provided
   * GITHUB_TOKEN/GH_TOKEN still takes precedence and can't be edited here.
   */
  app.post("/api/setup/github-token", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim();

    if (!token) {
      ctx.secrets.update({ githubToken: undefined });
      return c.json<SetupResultDto>({ ok: true, message: "GitHub token removed." });
    }

    const check = await checkGithubToken(token);
    if (check.ok) {
      ctx.secrets.update({ githubToken: token });
    }
    return c.json<SetupResultDto>({ ok: check.ok, message: check.message }, check.ok ? 200 : 400);
  });
}
