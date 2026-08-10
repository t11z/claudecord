import { type AppContext, createContext } from "./context.js";
import { startDiscord } from "./discord/client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import type { LegacySecretsKey } from "./secrets.js";
import { startWebServer } from "./web/server.js";

/**
 * claudecord no longer accepts an instance-wide Claude or GitHub credential —
 * every run is billed to the acting Discord user's own linked identity (see
 * /link-claude and /link-github). Warn loudly if a leftover credential from
 * the old model is still configured, since it is now silently ignored.
 */
function warnAboutLegacyCredentials(ctx: AppContext): void {
  const legacyEnvVars = [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "DASHBOARD_PASSWORD",
    "DASHBOARD_INSECURE_BIND",
  ];
  const presentEnvVars = legacyEnvVars.filter((name) => !!process.env[name]);
  if (presentEnvVars.length > 0) {
    ctx.logger.warn(
      { vars: presentEnvVars },
      "these environment variables are no longer read — claudecord now requires every user to link " +
        "their own Claude subscription (/link-claude) and, optionally, their own GitHub account " +
        "(/link-github), and dashboard login is now passwordless (run /dashboard in Discord to sign " +
        "in). Unset them or ignore this warning.",
    );
  }

  const legacySecretsKeys: LegacySecretsKey[] = [
    "claudeOauthToken",
    "anthropicApiKey",
    "githubToken",
    "dashboardPassword",
  ];
  // Via getLegacy, not a raw `!== undefined`: an empty string left over from an
  // old deploy is not a value, and this warning must agree with what
  // /api/migrate/status reports rather than nag about a key nobody can adopt.
  const presentSecretsKeys = legacySecretsKeys.filter((key) => ctx.secrets.getLegacy(key));
  if (presentSecretsKeys.length > 0) {
    ctx.logger.warn(
      { keys: presentSecretsKeys },
      "secrets.json still has values from the old instance-wide credential model — they are no " +
        "longer read. They are left in place in case you want to reuse one of them for your own " +
        "/link-claude or /link-github.",
    );
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const ctx = createContext(env, logger);
  warnAboutLegacyCredentials(ctx);

  // Turn a silent process death into a logged one. pino's `err` serializer
  // captures the stack and cause automatically. An uncaught exception leaves the
  // process in an undefined state, so we log and exit; a stray rejection is
  // logged but tolerated so one bad promise can't take the bot down.
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaughtException — exiting");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection");
  });

  // The dashboard no longer bootstraps the bot token — it has to be in .env
  // before the dashboard is reachable at all, since /dashboard (the only way
  // to sign in) requires the bot to already be online. See getting-started.md.
  startWebServer(ctx);

  const token = ctx.credentials().discordBotToken;
  if (!token) {
    logger.warn(
      "No DISCORD_BOT_TOKEN configured. Set it in .env and restart — there is no way to " +
        "supply it through the dashboard.",
    );
  } else {
    try {
      await startDiscord(ctx, token);
    } catch (err) {
      logger.error({ err }, "discord connection failed");
    }
  }

  const shutdown = () => {
    logger.info("shutting down");
    for (const controller of ctx.activeRuns.values()) controller.abort();
    ctx.discord?.destroy().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // Structured startup failure (pino captures stack + cause) rather than a bare
  // console.error that bypasses the log format and redaction.
  createLogger("error").fatal({ err }, "fatal startup error");
  process.exit(1);
});
