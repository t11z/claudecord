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
