import fs from "node:fs";
import path from "node:path";
import type { AuthMethod } from "./types.js";

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
 * Tokens entered through the dashboard setup wizard are stored in a
 * chmod-600 JSON file next to the database — never in SQLite, never logged.
 * Environment variables always take precedence over this file.
 */
export interface StoredSecrets {
  claudeOauthToken?: string;
  anthropicApiKey?: string;
  discordBotToken?: string;
  discordApplicationId?: string;
  /**
   * GitHub token (classic PAT, fine-grained PAT or app token). Wired into
   * agentic runs as GH_TOKEN/GITHUB_TOKEN so `git` and `gh` can reach the
   * repositories the token grants access to. Used as the operator-wide default
   * when a guild has no per-user GitHub role gate configured.
   */
  githubToken?: string;
  /** GitHub App used for per-user OAuth Device Flow linking. */
  githubAppClientId?: string;
  githubAppClientSecret?: string;
  /** Discord user id → their linked GitHub identity (tokens included). */
  githubIdentities?: Record<string, StoredGithubIdentity>;
  /** Auto-generated when DASHBOARD_PASSWORD is unset on a non-localhost bind. */
  dashboardPassword?: string;
}

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

  update(patch: Partial<StoredSecrets>): void {
    this.cache = { ...this.cache, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.cache, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(this.file, 0o600);
  }

  get(): StoredSecrets {
    return this.cache;
  }
}

export interface EffectiveCredentials {
  oauthToken?: string | undefined;
  apiKey?: string | undefined;
  discordBotToken?: string | undefined;
  discordApplicationId?: string | undefined;
  githubToken?: string | undefined;
  githubAppClientId?: string | undefined;
  githubAppClientSecret?: string | undefined;
  authMethod: AuthMethod;
}

export function resolveCredentials(
  env: {
    CLAUDE_CODE_OAUTH_TOKEN?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    DISCORD_BOT_TOKEN?: string | undefined;
    DISCORD_APPLICATION_ID?: string | undefined;
    GITHUB_TOKEN?: string | undefined;
    GH_TOKEN?: string | undefined;
    GITHUB_APP_CLIENT_ID?: string | undefined;
    GITHUB_APP_CLIENT_SECRET?: string | undefined;
  },
  stored: StoredSecrets,
): EffectiveCredentials {
  const oauthToken = env.CLAUDE_CODE_OAUTH_TOKEN ?? stored.claudeOauthToken;
  const apiKey = env.ANTHROPIC_API_KEY ?? stored.anthropicApiKey;
  return {
    oauthToken,
    apiKey,
    discordBotToken: env.DISCORD_BOT_TOKEN ?? stored.discordBotToken,
    discordApplicationId: env.DISCORD_APPLICATION_ID ?? stored.discordApplicationId,
    githubToken: env.GITHUB_TOKEN ?? env.GH_TOKEN ?? stored.githubToken,
    githubAppClientId: env.GITHUB_APP_CLIENT_ID ?? stored.githubAppClientId,
    githubAppClientSecret: env.GITHUB_APP_CLIENT_SECRET ?? stored.githubAppClientSecret,
    authMethod: oauthToken ? "oauth" : apiKey ? "api-key" : "none",
  };
}
