import { createContext } from "./context.js";
import { startDiscord } from "./discord/client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { warnAboutLegacyCredentials, warnAboutRemovedGithubGate } from "./startup-warnings.js";
import { startWebServer } from "./web/server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const ctx = createContext(env, logger);
  warnAboutLegacyCredentials(ctx);
  warnAboutRemovedGithubGate(ctx);

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
