import fs from "node:fs";
import path from "node:path";
import type { AuthMethod } from "./types.js";

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
   * repositories the token grants access to.
   */
  githubToken?: string;
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
    authMethod: oauthToken ? "oauth" : apiKey ? "api-key" : "none",
  };
}
