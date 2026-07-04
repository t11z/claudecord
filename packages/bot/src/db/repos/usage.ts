import type { Database } from "better-sqlite3";
import type { DailyStatDto, RecentErrorDto } from "../../types.js";

export interface UsageEntry {
  guildId: string;
  userId: string;
  threadId: string | null;
  startedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  ok: boolean;
  errorKind: string | null;
  /** Per-turn correlation id, ties this row to the run.* log lines. */
  runId?: string | null;
  /** SDK terminal subtype for a failed run, e.g. "error_max_turns". */
  errorSubtype?: string | null;
  /** Raw (truncated) failure text for post-hoc investigation. */
  errorDetail?: string | null;
}

export interface UsageTotals {
  runs: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class UsageRepo {
  constructor(private readonly db: Database) {}

  record(entry: UsageEntry): void {
    this.db
      .prepare(
        `INSERT INTO usage_log
           (guild_id, user_id, thread_id, started_at, duration_ms,
            input_tokens, output_tokens, cost_usd, model, ok, error_kind,
            run_id, error_subtype, error_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.guildId,
        entry.userId,
        entry.threadId,
        entry.startedAt,
        entry.durationMs,
        entry.inputTokens,
        entry.outputTokens,
        entry.costUsd,
        entry.model,
        entry.ok ? 1 : 0,
        entry.errorKind,
        entry.runId ?? null,
        entry.errorSubtype ?? null,
        entry.errorDetail ?? null,
      );
  }

  totalsSince(sinceIso: string): UsageTotals {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS runs,
                SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_log WHERE started_at >= ?`,
      )
      .get(sinceIso) as {
      runs: number;
      errors: number | null;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    };
    return {
      runs: row.runs,
      errors: row.errors ?? 0,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    };
  }

  guildTotalsSince(guildId: string, sinceIso: string): UsageTotals {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS runs,
                SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_log WHERE guild_id = ? AND started_at >= ?`,
      )
      .get(guildId, sinceIso) as {
      runs: number;
      errors: number | null;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    };
    return {
      runs: row.runs,
      errors: row.errors ?? 0,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    };
  }

  dailySince(sinceIso: string): DailyStatDto[] {
    const rows = this.db
      .prepare(
        `SELECT substr(started_at, 1, 10) AS date,
                COUNT(*) AS runs,
                SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_log WHERE started_at >= ?
         GROUP BY date ORDER BY date`,
      )
      .all(sinceIso) as {
      date: string;
      runs: number;
      errors: number | null;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }[];
    return rows.map((r) => ({
      date: r.date,
      runs: r.runs,
      errors: r.errors ?? 0,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
    }));
  }

  topGuildsSince(sinceIso: string, limit = 5): { guildId: string; runs: number }[] {
    const rows = this.db
      .prepare(
        `SELECT guild_id, COUNT(*) AS runs FROM usage_log
         WHERE started_at >= ? GROUP BY guild_id ORDER BY runs DESC LIMIT ?`,
      )
      .all(sinceIso, limit) as { guild_id: string; runs: number }[];
    return rows.map((r) => ({ guildId: r.guild_id, runs: r.runs }));
  }

  topUsersSince(sinceIso: string, limit = 5): { userId: string; runs: number }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, COUNT(*) AS runs FROM usage_log
         WHERE started_at >= ? GROUP BY user_id ORDER BY runs DESC LIMIT ?`,
      )
      .all(sinceIso, limit) as { user_id: string; runs: number }[];
    return rows.map((r) => ({ userId: r.user_id, runs: r.runs }));
  }

  lastRateLimitAt(): string | null {
    const row = this.db
      .prepare(
        `SELECT started_at FROM usage_log
         WHERE error_kind = 'rate_limit' ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { started_at: string } | undefined;
    return row?.started_at ?? null;
  }

  /**
   * The most recent failed runs, newest first, with their raw detail truncated
   * for display. Powers the dashboard's error panel — the `guildName` is filled
   * in by the caller from the live Discord cache.
   */
  recentErrorsSince(sinceIso: string, limit = 20): Omit<RecentErrorDto, "guildName">[] {
    const rows = this.db
      .prepare(
        `SELECT run_id, started_at, guild_id, error_kind, error_subtype,
                substr(error_detail, 1, 300) AS detail
         FROM usage_log
         WHERE ok = 0 AND started_at >= ?
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(sinceIso, limit) as {
      run_id: string | null;
      started_at: string;
      guild_id: string;
      error_kind: string | null;
      error_subtype: string | null;
      detail: string | null;
    }[];
    return rows.map((r) => ({
      runId: r.run_id,
      startedAt: r.started_at,
      guildId: r.guild_id,
      kind: r.error_kind,
      subtype: r.error_subtype,
      detail: r.detail,
    }));
  }
}
