/**
 * One-off checks the bot shouts about at startup. Separate from index.ts so they
 * can be tested — importing index.ts would boot the whole bot.
 */
import type { AppContext } from "./context.js";
import type { LegacySecretsKey } from "./secrets.js";

/**
 * claudecord no longer accepts an instance-wide Claude or GitHub credential —
 * every run is billed to the acting Discord user's own linked identity (see
 * /link-claude and /link-github). Warn loudly if a leftover credential from
 * the old model is still configured, since it is now silently ignored.
 */
export function warnAboutLegacyCredentials(ctx: AppContext): void {
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

/**
 * The separate GitHub role gate is gone — GitHub now follows the bot's own
 * allowed roles. On most installs the two lists held the same values, so
 * nothing changes. Where they differed, the GitHub restriction has just been
 * lifted, and a security rule must never widen silently: say so once, per
 * guild, naming what changed.
 */
export function warnAboutRemovedGithubGate(ctx: AppContext): void {
  for (const config of ctx.repos.guildConfig.list()) {
    if (config.githubRoleIds.length === 0) continue;
    const same =
      config.githubRoleIds.length === config.allowedRoleIds.length &&
      config.githubRoleIds.every((id) => config.allowedRoleIds.includes(id));
    if (same) continue;
    ctx.logger.warn(
      {
        guildId: config.guildId,
        formerGithubRoleIds: config.githubRoleIds,
        allowedRoleIds: config.allowedRoleIds,
      },
      "the separate GitHub role gate has been removed — GitHub access now follows this server's " +
        "allowed roles, which are broader than the GitHub roles this server had set. Review " +
        "Access control if that is not what you want.",
    );
  }
}
