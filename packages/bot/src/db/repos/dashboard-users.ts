import type { Database } from "better-sqlite3";

/**
 * A dashboard account: profile + role, keyed by Discord user id. Created and
 * updated on magic-link redemption (see web/routes/auth.ts). Never holds a
 * token — those live in secrets.json per the CLAUDE.md storage rule.
 */
export interface DashboardUser {
  discordUserId: string;
  username: string | null;
  globalName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  githubSkipped: boolean;
  firstLoginAt: string;
  lastLoginAt: string;
}

interface Row {
  discord_user_id: string;
  username: string | null;
  global_name: string | null;
  avatar_url: string | null;
  is_admin: number;
  github_skipped: number;
  first_login_at: string;
  last_login_at: string;
}

function toUser(row: Row): DashboardUser {
  return {
    discordUserId: row.discord_user_id,
    username: row.username,
    globalName: row.global_name,
    avatarUrl: row.avatar_url,
    isAdmin: row.is_admin === 1,
    githubSkipped: row.github_skipped === 1,
    firstLoginAt: row.first_login_at,
    lastLoginAt: row.last_login_at,
  };
}

export class DashboardUsersRepo {
  constructor(private readonly db: Database) {}

  get(discordUserId: string): DashboardUser | undefined {
    const row = this.db
      .prepare("SELECT * FROM dashboard_users WHERE discord_user_id = ?")
      .get(discordUserId) as Row | undefined;
    return row ? toUser(row) : undefined;
  }

  list(): DashboardUser[] {
    const rows = this.db
      .prepare("SELECT * FROM dashboard_users ORDER BY first_login_at ASC")
      .all() as Row[];
    return rows.map(toUser);
  }

  /** Whether any account currently holds admin — used to decide claim-on-first-login. */
  anyAdmin(): boolean {
    const row = this.db.prepare("SELECT 1 FROM dashboard_users WHERE is_admin = 1 LIMIT 1").get();
    return row !== undefined;
  }

  /**
   * Upserts the profile and role on login. `firstLoginAt` is only ever set
   * once; `isAdmin` is the caller's already-computed decision (see
   * `routes/auth.ts` — env override, existing flag, or first-login claim),
   * never re-derived here.
   */
  upsertLogin(input: {
    discordUserId: string;
    username: string;
    globalName: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    now: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO dashboard_users
           (discord_user_id, username, global_name, avatar_url, is_admin, first_login_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(discord_user_id) DO UPDATE SET
           username = excluded.username,
           global_name = excluded.global_name,
           avatar_url = excluded.avatar_url,
           is_admin = excluded.is_admin,
           last_login_at = excluded.last_login_at`,
      )
      .run(
        input.discordUserId,
        input.username,
        input.globalName,
        input.avatarUrl,
        input.isAdmin ? 1 : 0,
        input.now,
        input.now,
      );
  }

  setGithubSkipped(discordUserId: string, skipped: boolean): void {
    this.db
      .prepare("UPDATE dashboard_users SET github_skipped = ? WHERE discord_user_id = ?")
      .run(skipped ? 1 : 0, discordUserId);
  }
}
