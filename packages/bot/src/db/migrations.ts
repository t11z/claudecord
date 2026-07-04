import type { Database } from "better-sqlite3";

/**
 * Ordered list of migrations. The array index + 1 is the schema version,
 * tracked via SQLite's PRAGMA user_version. Never edit an existing entry —
 * append a new one.
 */
export const migrations: string[] = [
  // v1 — core tables
  `
  CREATE TABLE thread_sessions (
    thread_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    claude_session_id TEXT,
    model TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'chat',
    cwd TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    turn_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_thread_sessions_guild ON thread_sessions(guild_id);

  CREATE TABLE guild_config (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    allowed_channel_ids TEXT NOT NULL DEFAULT '[]',
    allowed_role_ids TEXT NOT NULL DEFAULT '[]',
    agentic_enabled INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    system_prompt_extra TEXT
  );

  CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    thread_id TEXT,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    ok INTEGER NOT NULL,
    error_kind TEXT
  );
  CREATE INDEX idx_usage_log_started ON usage_log(started_at);
  CREATE INDEX idx_usage_log_guild ON usage_log(guild_id);

  CREATE TABLE app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — per-user GitHub role gate. When non-empty, only members with one of
  // these roles may use their linked GitHub identity in agentic runs, and the
  // shared operator token is never used as a fallback in that guild.
  `
  ALTER TABLE guild_config ADD COLUMN github_role_ids TEXT NOT NULL DEFAULT '[]';
  `,
  // v3 — observability: a per-turn correlation id plus the raw failure reason,
  // so an unknown/aborted run can be investigated after the fact instead of
  // leaving only a coarse error_kind category behind.
  `
  ALTER TABLE usage_log ADD COLUMN run_id TEXT;
  ALTER TABLE usage_log ADD COLUMN error_subtype TEXT;
  ALTER TABLE usage_log ADD COLUMN error_detail TEXT;
  `,
];

export function runMigrations(db: Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < migrations.length; version++) {
    const sql = migrations[version]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
