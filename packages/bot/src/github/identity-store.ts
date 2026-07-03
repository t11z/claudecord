/**
 * Per-user GitHub identities: which Discord user linked which GitHub account,
 * and the tokens to act as them. Tokens are persisted through the SecretsStore
 * (the chmod-600 secrets file) — never SQLite, never logs.
 *
 * `getFreshToken` is the hot path: it hands out a valid access token for a
 * given Discord user, transparently refreshing an expiring one first.
 */
import type { Logger } from "../logger.js";
import type { SecretsStore, StoredGithubIdentity } from "../secrets.js";
import type { UserTokens } from "./device-flow.js";
import { refreshUserToken } from "./refresh.js";
import { checkGithubToken } from "./verify.js";

/** Non-secret projection safe to return from the dashboard API. */
export interface GithubIdentitySummary {
  discordUserId: string;
  login: string | null;
  linkedAt: string;
  expiresAt: string | null;
}

export interface GithubAppConfig {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

/** Refresh a token this long before it actually expires, to absorb clock skew. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export class GithubIdentityStore {
  constructor(
    private readonly secrets: SecretsStore,
    private readonly app: () => GithubAppConfig,
    private readonly logger?: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  private all(): Record<string, StoredGithubIdentity> {
    return this.secrets.get().githubIdentities ?? {};
  }

  get(discordUserId: string): StoredGithubIdentity | undefined {
    return this.all()[discordUserId];
  }

  /** Store a freshly obtained token pair, resolving the GitHub login for display. */
  async link(discordUserId: string, tokens: UserTokens): Promise<GithubIdentitySummary> {
    const check = await checkGithubToken(tokens.accessToken);
    const identity: StoredGithubIdentity = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      login: check.login ?? null,
      linkedAt: new Date(this.now()).toISOString(),
    };
    this.write(discordUserId, identity);
    return this.toSummary(discordUserId, identity);
  }

  unlink(discordUserId: string): boolean {
    const all = { ...this.all() };
    if (!(discordUserId in all)) return false;
    delete all[discordUserId];
    this.secrets.update({ githubIdentities: all });
    return true;
  }

  /**
   * A valid access token for the user, refreshed if it is expired/expiring.
   * Returns null when the user hasn't linked or a refresh definitively fails.
   */
  async getFreshToken(discordUserId: string): Promise<string | null> {
    const identity = this.get(discordUserId);
    if (!identity) return null;
    if (!this.isExpiring(identity)) return identity.accessToken;

    const { clientId, clientSecret } = this.app();
    if (!identity.refreshToken || !clientId || !clientSecret) {
      // Non-expiring App tokens, or missing refresh material: hand back what we
      // have and let GitHub reject it if it is genuinely invalid.
      return identity.accessToken;
    }

    try {
      const refreshed = await refreshUserToken(
        clientId,
        clientSecret,
        identity.refreshToken,
        this.now,
      );
      const updated: StoredGithubIdentity = {
        ...identity,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? identity.refreshToken,
        expiresAt: refreshed.expiresAt,
      };
      this.write(discordUserId, updated);
      return updated.accessToken;
    } catch (err) {
      this.logger?.warn({ err, discordUserId }, "github token refresh failed");
      return null;
    }
  }

  list(): GithubIdentitySummary[] {
    return Object.entries(this.all()).map(([id, identity]) => this.toSummary(id, identity));
  }

  private isExpiring(identity: StoredGithubIdentity): boolean {
    if (!identity.expiresAt) return false;
    const expMs = Date.parse(identity.expiresAt);
    if (Number.isNaN(expMs)) return false;
    return expMs - REFRESH_SKEW_MS <= this.now();
  }

  private write(discordUserId: string, identity: StoredGithubIdentity): void {
    this.secrets.update({ githubIdentities: { ...this.all(), [discordUserId]: identity } });
  }

  private toSummary(discordUserId: string, identity: StoredGithubIdentity): GithubIdentitySummary {
    return {
      discordUserId,
      login: identity.login ?? null,
      linkedAt: identity.linkedAt,
      expiresAt: identity.expiresAt,
    };
  }
}
