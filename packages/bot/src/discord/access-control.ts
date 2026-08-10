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
 * Whether this member may use the bot in this guild at all — the guild switch
 * plus the role allowlist, with no channel dimension.
 *
 * Split out from `isAllowed` because signing in to the dashboard asks exactly
 * this question and has no channel to ask it about. Calling `isAllowed` with a
 * made-up channel id would return false on every guild that has a channel
 * allowlist, silently barring those members from the dashboard while
 * `/dashboard` kept working. `isAllowed` delegates here so the two can't drift.
 */
export function mayUseBot(config: GuildConfig, memberRoleIds: string[]): boolean {
  if (!config.enabled) return false;
  if (config.allowedRoleIds.length === 0) return true;
  return memberRoleIds.some((r) => config.allowedRoleIds.includes(r));
}

/**
 * Allowlist semantics: an empty list means "everything allowed".
 * For threads, the parent channel is what must be allowlisted.
 */
export function isAllowed(config: GuildConfig, q: AccessQuery): boolean {
  if (!mayUseBot(config, q.memberRoleIds)) return false;

  if (config.allowedChannelIds.length > 0) {
    const effectiveChannel = q.parentChannelId ?? q.channelId;
    if (
      !config.allowedChannelIds.includes(effectiveChannel) &&
      !config.allowedChannelIds.includes(q.channelId)
    ) {
      return false;
    }
  }

  return true;
}

/*
 * There is deliberately no separate GitHub role gate. Whoever may talk to the
 * bot may also connect their own GitHub account and have it used in their own
 * agentic runs — one rule, `mayUseBot`, rather than two lists that in practice
 * held identical values. The real control over GitHub is `agenticEnabled`,
 * which is per-guild, off by default, and carries the warning that matters:
 * a token is only ever used for its owner's own runs, so linking is a decision
 * about oneself.
 */
