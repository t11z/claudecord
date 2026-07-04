import { checkClaudeAuth } from "./claude/auth-check.js";
import { createContext } from "./context.js";
import { startDiscord } from "./discord/client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { startWebServer } from "./web/server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const ctx = createContext(env, logger);

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

  const connectDiscord = async (): Promise<string | null> => {
    if (ctx.discord?.isReady()) return null;
    const token = ctx.credentials().discordBotToken;
    if (!token) return "No Discord bot token configured.";
    try {
      await startDiscord(ctx, token);
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "discord connection failed");
      return message;
    }
  };

  startWebServer(ctx, { onDiscordTokenSaved: connectDiscord });

  const creds = ctx.credentials();
  if (creds.authMethod === "none") {
    logger.warn(
      "No Claude credential found. Open the dashboard to finish setup: " +
        `http://${env.DASHBOARD_HOST}:${env.DASHBOARD_PORT} — or set CLAUDE_CODE_OAUTH_TOKEN ` +
        "(create one with `claude setup-token`).",
    );
  } else {
    logger.info({ method: creds.authMethod }, "checking Claude credentials…");
    const check = await checkClaudeAuth(ctx.engine);
    ctx.authValid = check.ok;
    if (check.ok) {
      logger.info(check.message);
    } else {
      logger.error(`Claude auth check failed: ${check.message}`);
    }
  }

  const discordError = await connectDiscord();
  if (discordError) {
    logger.warn(
      `Discord not connected yet (${discordError}). Finish setup in the dashboard: ` +
        `http://${env.DASHBOARD_HOST}:${env.DASHBOARD_PORT}`,
    );
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
