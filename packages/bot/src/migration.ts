/**
 * Detects whether an install predates the current per-user, passwordless
 * auth model, so the dashboard's migration wizard (web/routes/migrate.ts)
 * knows whether to show itself. Kept free of any web/Hono dependency so
 * index.ts can stamp fresh installs at startup without importing a route.
 */
import type { AppContext } from "./context.js";
import type { LegacySecretsKey } from "./secrets.js";

export const MIGRATION_VERSION_KEY = "migration_version";
export const CURRENT_MIGRATION_VERSION = "1";

export const LEGACY_SECRETS_KEYS: readonly LegacySecretsKey[] = [
  "claudeOauthToken",
  "anthropicApiKey",
  "githubToken",
  "dashboardPassword",
];

/**
 * Whether this install has any state from before the current auth model: a
 * linked identity, a prior conversation thread, or a leftover legacy secret.
 * A genuinely fresh install has none of these and never needs the wizard.
 */
export function hasPriorState(ctx: AppContext): boolean {
  if (ctx.claude.list().length > 0) return true;
  if (ctx.github.list().length > 0) return true;
  if (ctx.repos.sessions.hasAny()) return true;
  return LEGACY_SECRETS_KEYS.some((key) => ctx.secrets.getLegacy(key) !== undefined);
}

/**
 * Stamps `migration_version` immediately for installs with no prior state,
 * so the wizard never appears on a fresh setup. Installs that DO have prior
 * state are left unstamped until an admin completes (or skips) the wizard.
 */
export function stampFreshInstall(ctx: AppContext): void {
  if (ctx.repos.appConfig.get(MIGRATION_VERSION_KEY) !== undefined) return;
  if (hasPriorState(ctx)) return;
  ctx.repos.appConfig.set(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION);
}
