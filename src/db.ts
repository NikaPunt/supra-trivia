import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/**
 * The schema, as numbered steps. `PRAGMA user_version` records how many have run, so each runs once per database.
 * Step 1 is written to be safe on a database made before versions were tracked (those report version 0 with the tables already there).
 * To change the schema, append a step; never edit one that has shipped.
 */
const STEPS: ((db: Db) => void)[] = [
  (db) => {
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
    -- Work in progress from the builder. Never read by games or listings; the saved trivia only changes when the host hits Save.
    CREATE TABLE IF NOT EXISTS drafts (
      trivia_id  TEXT NOT NULL REFERENCES trivias(id) ON DELETE CASCADE,
      host_email TEXT NOT NULL,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (trivia_id, host_email)
    );
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
  },
  // A counter per host: raising it signs that host out everywhere. Hosts with no row are at 0, which is what every earlier login carries.
  (db) => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS host_auth (
      host_email TEXT PRIMARY KEY,
      epoch      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_ended ON games(ended, updated_at);
  `);
  },
  // What happened in each game, question by question, kept after the live state has moved on. And where an audited action came from.
  (db) => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS game_records (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      at      INTEGER NOT NULL,
      kind    TEXT NOT NULL,
      data    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS game_records_game ON game_records(game_id, id);
    CREATE INDEX IF NOT EXISTS audit_action ON audit(action, actor);
  `);
    if (!(db.pragma("table_info(audit)") as { name: string }[]).some((c) => c.name === "ip")) db.exec("ALTER TABLE audit ADD COLUMN ip TEXT");
  },
];

export const SCHEMA_VERSION = STEPS.length;

function migrate(db: Db): void {
  const at = db.pragma("user_version", { simple: true }) as number;
  if (at > STEPS.length) throw new Error(`the database is from a newer version of the app (schema ${at}, this build knows ${STEPS.length}); refusing to touch it`);
  for (let i = at; i < STEPS.length; i++) {
    db.transaction(() => {
      STEPS[i]!(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
