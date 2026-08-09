import fs from "node:fs";
import path from "node:path";

/**
 * A single Discord user's linked GitHub identity. The tokens live here (in the
 * chmod-600 secrets file), never in SQLite — see the CLAUDE.md storage rule.
 */
export interface StoredGithubIdentity {
  accessToken: string;
  refreshToken?: string | undefined;
  /** ISO expiry, or null when the App issues non-expiring tokens. */
  expiresAt: string | null;
  /** GitHub login resolved at link time, for display. */
  login?: string | null | undefined;
  linkedAt: string;
}

/**
 * A single Discord user's linked Claude Code OAuth token (from
 * `claude setup-token`). No refresh flow — the SDK has none for this token
 * type — so relinking is how a user rotates it.
 */
export interface StoredClaudeIdentity {
  oauthToken: string;
  linkedAt: string;
  /** ISO timestamp of the last successful auth check, or null if never re-checked. */
  lastVerifiedAt: string | null;
}

/**
 * Tokens entered through the dashboard setup wizard are stored in a
 * chmod-600 JSON file next to the database — never in SQLite, never logged.
 * Environment variables always take precedence over this file.
 */
export interface StoredSecrets {
  discordBotToken?: string;
  discordApplicationId?: string;
  /** GitHub App used for per-user OAuth Device Flow linking. */
  githubAppClientId?: string;
  githubAppClientSecret?: string;
  /** Discord user id → their linked GitHub identity (tokens included). */
  githubIdentities?: Record<string, StoredGithubIdentity>;
  /** Discord user id → their linked Claude Code OAuth token. */
  claudeIdentities?: Record<string, StoredClaudeIdentity>;
}

/**
 * Fields the old instance-wide credential model wrote to secrets.json. No
 * longer part of {@link StoredSecrets} — a fresh install never has them — but
 * an upgraded install's file can still carry one, and the migration wizard
 * (web/routes/migrate.ts) needs to read and clear them without widening the
 * current type.
 */
export type LegacySecretsKey =
  | "claudeOauthToken"
  | "anthropicApiKey"
  | "githubToken"
  | "dashboardPassword";

export class SecretsStore {
  private readonly file: string;
  private cache: StoredSecrets;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "secrets.json");
    this.cache = this.load();
  }

  private load(): StoredSecrets {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as StoredSecrets;
    } catch {
      return {};
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.cache, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(this.file, 0o600);
  }

  update(patch: Partial<StoredSecrets>): void {
    this.cache = { ...this.cache, ...patch };
    this.persist();
  }

  get(): StoredSecrets {
    return this.cache;
  }

  /** The raw value of a legacy key, if the file still carries one from before the per-user model. */
  getLegacy(key: LegacySecretsKey): string | undefined {
    const value = (this.cache as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }

  /** Removes legacy keys from the file entirely, once claimed or explicitly discarded. */
  deleteLegacyKeys(keys: LegacySecretsKey[]): void {
    const raw = { ...(this.cache as unknown as Record<string, unknown>) };
    for (const key of keys) delete raw[key];
    this.cache = raw as StoredSecrets;
    this.persist();
  }
}

/**
 * What's left instance-wide once Claude and GitHub credentials are per-user:
 * infrastructure the operator supplies, not anything a run is billed against.
 */
export interface EffectiveCredentials {
  discordBotToken?: string | undefined;
  discordApplicationId?: string | undefined;
  githubAppClientId?: string | undefined;
  githubAppClientSecret?: string | undefined;
}

export function resolveCredentials(
  env: {
    DISCORD_BOT_TOKEN?: string | undefined;
    DISCORD_APPLICATION_ID?: string | undefined;
    GITHUB_APP_CLIENT_ID?: string | undefined;
    GITHUB_APP_CLIENT_SECRET?: string | undefined;
  },
  stored: StoredSecrets,
): EffectiveCredentials {
  return {
    discordBotToken: env.DISCORD_BOT_TOKEN ?? stored.discordBotToken,
    discordApplicationId: env.DISCORD_APPLICATION_ID ?? stored.discordApplicationId,
    githubAppClientId: env.GITHUB_APP_CLIENT_ID ?? stored.githubAppClientId,
    githubAppClientSecret: env.GITHUB_APP_CLIENT_SECRET ?? stored.githubAppClientSecret,
  };
}
