import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS trivias (
      id         TEXT PRIMARY KEY,
      host_email TEXT NOT NULL,
      title      TEXT NOT NULL,
      rounds     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trivias_host ON trivias(host_email);
    CREATE TABLE IF NOT EXISTS games (
      id         TEXT PRIMARY KEY,
      code       TEXT NOT NULL,
      host_email TEXT NOT NULL,
      ended      INTEGER NOT NULL DEFAULT 0,
      state      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seeded (
      host_email TEXT PRIMARY KEY,
      at         INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      at     INTEGER NOT NULL,
      actor  TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      detail TEXT
    );
  `);
  if (!(db.pragma("table_info(trivias)") as { name: string }[]).some((c) => c.name === "settings")) {
    db.exec("ALTER TABLE trivias ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
  }
  return db;
}
