import type { GuildConfig } from "../db/repos/guild-config.js";

export interface AccessQuery {
  /** Channel the message was sent in (may be a thread). */
  channelId: string;
  /** Parent channel when the message is inside a thread. */
  parentChannelId: string | null;
  /** Role IDs of the message author. */
  memberRoleIds: string[];
}

/**
 * Allowlist semantics: an empty list means "everything allowed".
 * For threads, the parent channel is what must be allowlisted.
 */
export function isAllowed(config: GuildConfig, q: AccessQuery): boolean {
  if (!config.enabled) return false;

  if (config.allowedChannelIds.length > 0) {
    const effectiveChannel = q.parentChannelId ?? q.channelId;
    if (
      !config.allowedChannelIds.includes(effectiveChannel) &&
      !config.allowedChannelIds.includes(q.channelId)
    ) {
      return false;
    }
  }

  if (config.allowedRoleIds.length > 0) {
    if (!q.memberRoleIds.some((r) => config.allowedRoleIds.includes(r))) {
      return false;
    }
  }

  return true;
}

/**
 * Whether a per-user GitHub role gate is active for this guild — i.e. at least
 * one role must hold a linked GitHub identity to use it in agentic runs.
 */
export function isGithubGateActive(config: GuildConfig): boolean {
  return config.githubRoleIds.length > 0;
}

/**
 * Whether a member is permitted to use their own GitHub identity in agentic
 * runs. With no gate configured, everyone is (subject to actually having linked).
 */
export function canUseGithub(config: GuildConfig, memberRoleIds: string[]): boolean {
  if (!isGithubGateActive(config)) return true;
  return memberRoleIds.some((r) => config.githubRoleIds.includes(r));
}

/**
 * Pure decision for which GitHub token an agentic turn runs with.
 * - Gate active: only gated-in members get a token, and strictly their own —
 *   the shared operator token is never a fallback (safe on multi-user servers).
 * - No gate: the member's own linked token if any, else the shared token.
 */
export function chooseGithubToken(opts: {
  gateActive: boolean;
  memberAllowed: boolean;
  perUserToken: string | null;
  sharedToken: string | undefined;
}): string | undefined {
  if (opts.gateActive) {
    if (!opts.memberAllowed) return undefined;
    return opts.perUserToken ?? undefined;
  }
  return opts.perUserToken ?? opts.sharedToken;
}
