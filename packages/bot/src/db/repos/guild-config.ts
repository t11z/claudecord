import type { Database } from "better-sqlite3";

export interface GuildConfig {
  guildId: string;
  enabled: boolean;
  allowedChannelIds: string[];
  allowedRoleIds: string[];
  agenticEnabled: boolean;
  /**
   * Roles allowed to link & use their own GitHub identity in agentic runs.
   * Empty = no per-user gate (the shared GITHUB_TOKEN behaviour, if configured).
   */
  githubRoleIds: string[];
  model: string | null;
  systemPromptExtra: string | null;
}

export const DEFAULT_GUILD_CONFIG: Omit<GuildConfig, "guildId"> = {
  enabled: true,
  allowedChannelIds: [],
  allowedRoleIds: [],
  agenticEnabled: false,
  githubRoleIds: [],
  model: null,
  systemPromptExtra: null,
};

interface Row {
  guild_id: string;
  enabled: number;
  allowed_channel_ids: string;
  allowed_role_ids: string;
  agentic_enabled: number;
  github_role_ids: string;
  model: string | null;
  system_prompt_extra: string | null;
}

function parseIdList(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toConfig(row: Row): GuildConfig {
  return {
    guildId: row.guild_id,
    enabled: row.enabled === 1,
    allowedChannelIds: parseIdList(row.allowed_channel_ids),
    allowedRoleIds: parseIdList(row.allowed_role_ids),
    agenticEnabled: row.agentic_enabled === 1,
    githubRoleIds: parseIdList(row.github_role_ids),
    model: row.model,
    systemPromptExtra: row.system_prompt_extra,
  };
}

export class GuildConfigRepo {
  constructor(private readonly db: Database) {}

  get(guildId: string): GuildConfig {
    const row = this.db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as
      | Row
      | undefined;
    return row ? toConfig(row) : { guildId, ...DEFAULT_GUILD_CONFIG };
  }

  upsert(config: GuildConfig): void {
    this.db
      .prepare(
        `INSERT INTO guild_config
           (guild_id, enabled, allowed_channel_ids, allowed_role_ids,
            agentic_enabled, github_role_ids, model, system_prompt_extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           enabled = excluded.enabled,
           allowed_channel_ids = excluded.allowed_channel_ids,
           allowed_role_ids = excluded.allowed_role_ids,
           agentic_enabled = excluded.agentic_enabled,
           github_role_ids = excluded.github_role_ids,
           model = excluded.model,
           system_prompt_extra = excluded.system_prompt_extra`,
      )
      .run(
        config.guildId,
        config.enabled ? 1 : 0,
        JSON.stringify(config.allowedChannelIds),
        JSON.stringify(config.allowedRoleIds),
        config.agenticEnabled ? 1 : 0,
        JSON.stringify(config.githubRoleIds),
        config.model,
        config.systemPromptExtra,
      );
  }
}
