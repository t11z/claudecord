/**
 * Per-user Claude identities: which Discord user linked which Claude Code
 * OAuth token. Tokens are persisted through the SecretsStore (the chmod-600
 * secrets file) — never in SQLite, never in logs.
 *
 * There is no refresh flow for this token type (see maintainer/agent-sdk.md),
 * so `getToken` just hands back what's stored — relinking is how a user
 * rotates an expired or revoked token.
 */
import type { SecretsStore, StoredClaudeIdentity } from "../secrets.js";

/** Non-secret projection safe to return from the dashboard API. */
export interface ClaudeIdentitySummary {
  discordUserId: string;
  linkedAt: string;
  lastVerifiedAt: string | null;
}

export class ClaudeIdentityStore {
  constructor(
    private readonly secrets: SecretsStore,
    private readonly now: () => number = Date.now,
  ) {}

  private all(): Record<string, StoredClaudeIdentity> {
    return this.secrets.get().claudeIdentities ?? {};
  }

  get(discordUserId: string): StoredClaudeIdentity | undefined {
    return this.all()[discordUserId];
  }

  /** The acting user's Claude Code OAuth token, or null if they haven't linked. */
  getToken(discordUserId: string): string | null {
    return this.get(discordUserId)?.oauthToken ?? null;
  }

  /** Store a freshly verified token, replacing any existing one for this user. */
  link(discordUserId: string, oauthToken: string): ClaudeIdentitySummary {
    const identity: StoredClaudeIdentity = {
      oauthToken,
      linkedAt: new Date(this.now()).toISOString(),
      lastVerifiedAt: new Date(this.now()).toISOString(),
    };
    this.write(discordUserId, identity);
    return this.toSummary(discordUserId, identity);
  }

  /** Record that a stored token was just re-verified as working. */
  markVerified(discordUserId: string): void {
    const identity = this.get(discordUserId);
    if (!identity) return;
    this.write(discordUserId, { ...identity, lastVerifiedAt: new Date(this.now()).toISOString() });
  }

  unlink(discordUserId: string): boolean {
    const all = { ...this.all() };
    if (!(discordUserId in all)) return false;
    delete all[discordUserId];
    this.secrets.update({ claudeIdentities: all });
    return true;
  }

  list(): ClaudeIdentitySummary[] {
    return Object.entries(this.all()).map(([id, identity]) => this.toSummary(id, identity));
  }

  private write(discordUserId: string, identity: StoredClaudeIdentity): void {
    this.secrets.update({ claudeIdentities: { ...this.all(), [discordUserId]: identity } });
  }

  private toSummary(discordUserId: string, identity: StoredClaudeIdentity): ClaudeIdentitySummary {
    return {
      discordUserId,
      linkedAt: identity.linkedAt,
      lastVerifiedAt: identity.lastVerifiedAt,
    };
  }
}

export const CLAUDE_LINK_REQUIRED =
  "🔑 You haven't connected a Claude subscription yet. Run `/link-claude link`, or open the " +
  "dashboard with `/dashboard` and go to *Your account*. Either way you'll need a token from " +
  "`claude setup-token`.";
