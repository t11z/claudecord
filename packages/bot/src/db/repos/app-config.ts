import type { Database } from "better-sqlite3";

/** Simple key/value store for app-level settings (never secrets/tokens). */
export class AppConfigRepo {
  constructor(private readonly db: Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  /** Returns the existing value or stores and returns the provided default. */
  getOrInit(key: string, init: () => string): string {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const value = init();
    this.set(key, value);
    return value;
  }
}
