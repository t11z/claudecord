import fs from "node:fs";
import path from "node:path";
import SqliteDatabase, { type Database } from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type { Database };

export function openDatabase(dataDir: string): Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new SqliteDatabase(path.join(dataDir, "claudecord.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

/** In-memory database for tests. */
export function openMemoryDatabase(): Database {
  const db = new SqliteDatabase(":memory:");
  runMigrations(db);
  return db;
}
