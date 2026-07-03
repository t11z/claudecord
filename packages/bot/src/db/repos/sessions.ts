import type { Database } from "better-sqlite3";
import type { RunMode } from "../../types.js";

export interface ThreadSession {
  threadId: string;
  guildId: string;
  channelId: string;
  claudeSessionId: string | null;
  model: string;
  mode: RunMode;
  cwd: string;
  createdAt: string;
  lastActiveAt: string;
  turnCount: number;
}

interface Row {
  thread_id: string;
  guild_id: string;
  channel_id: string;
  claude_session_id: string | null;
  model: string;
  mode: string;
  cwd: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
}

function toSession(row: Row): ThreadSession {
  return {
    threadId: row.thread_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    claudeSessionId: row.claude_session_id,
    model: row.model,
    mode: row.mode === "agentic" ? "agentic" : "chat",
    cwd: row.cwd,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    turnCount: row.turn_count,
  };
}

export class SessionRepo {
  constructor(private readonly db: Database) {}

  get(threadId: string): ThreadSession | undefined {
    const row = this.db
      .prepare("SELECT * FROM thread_sessions WHERE thread_id = ?")
      .get(threadId) as Row | undefined;
    return row ? toSession(row) : undefined;
  }

  create(session: Omit<ThreadSession, "createdAt" | "lastActiveAt" | "turnCount">): ThreadSession {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO thread_sessions
           (thread_id, guild_id, channel_id, claude_session_id, model, mode, cwd,
            created_at, last_active_at, turn_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        session.threadId,
        session.guildId,
        session.channelId,
        session.claudeSessionId,
        session.model,
        session.mode,
        session.cwd,
        now,
        now,
      );
    return this.get(session.threadId)!;
  }

  setClaudeSessionId(threadId: string, claudeSessionId: string): void {
    this.db
      .prepare("UPDATE thread_sessions SET claude_session_id = ? WHERE thread_id = ?")
      .run(claudeSessionId, threadId);
  }

  touch(threadId: string): void {
    this.db
      .prepare(
        `UPDATE thread_sessions
         SET last_active_at = ?, turn_count = turn_count + 1
         WHERE thread_id = ?`,
      )
      .run(new Date().toISOString(), threadId);
  }

  delete(threadId: string): boolean {
    const result = this.db.prepare("DELETE FROM thread_sessions WHERE thread_id = ?").run(threadId);
    return result.changes > 0;
  }

  list(limit = 100): ThreadSession[] {
    const rows = this.db
      .prepare("SELECT * FROM thread_sessions ORDER BY last_active_at DESC LIMIT ?")
      .all(limit) as Row[];
    return rows.map(toSession);
  }

  /** Sessions idle since before the cutoff — candidates for pruning. */
  listIdleSince(cutoffIso: string): ThreadSession[] {
    const rows = this.db
      .prepare("SELECT * FROM thread_sessions WHERE last_active_at < ?")
      .all(cutoffIso) as Row[];
    return rows.map(toSession);
  }
}
