import { EventEmitter } from "node:events";
import type { Db } from "./db.js";
import { act, makeCode, reviveGame, takeRecords, type Game, type GameRecord, type Phase } from "./game.js";

/** What listings need to know about a game, small enough to keep for every game ever played. */
export interface GameSummary {
  id: string;
  code: string;
  title: string;
  phase: Phase;
  hostEmail: string;
  players: number;
  createdAt: number;
}

const summarize = (g: Game): GameSummary => ({ id: g.id, code: g.code, title: g.title, phase: g.phase, hostEmail: g.hostEmail, players: g.players.length, createdAt: g.createdAt });

/** A finished game stays in memory this long (final scores are still being looked at), then is read from the database when asked for. */
const KEEP_ENDED_MS = 24 * 3600 * 1000;
const SWEEP_MS = 3600 * 1000;

/**
 * Live games held in memory and written through to SQLite on every change, so a restart loses nothing.
 * Finished games older than a day are kept only as a one-line summary; their full state stays in the database.
 */
export class GameStore {
  private games = new Map<string, Game>();
  /** Finished games whose full state is no longer in memory. */
  private archived = new Map<string, GameSummary>();
  private byCode = new Map<string, string>();
  /** Emits `game.id` whenever that game changes; SSE connections listen on it. */
  readonly bus = new EventEmitter().setMaxListeners(0);
  /** Ids of stored games that could not be read at start. They are left in the database untouched. */
  readonly unreadable: string[] = [];

  private timers = new Map<string, NodeJS.Timeout>();
  private sweeper: NodeJS.Timeout;
  private upsert;
  private readState;
  private addRecord;
  private write;

  /** `retentionDays`: finished games older than this are deleted for good. 0 keeps them forever. */
  constructor(private db: Db, private retentionDays = 0) {
    this.upsert = db.prepare("INSERT INTO games (id, code, host_email, ended, state, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ended = excluded.ended, state = excluded.state, updated_at = excluded.updated_at");
    this.readState = db.prepare("SELECT state FROM games WHERE id = ?");
    this.addRecord = db.prepare("INSERT INTO game_records (game_id, at, kind, data) VALUES (?, ?, ?, ?)");
    // The state and the records that go with it are written together or not at all.
    this.write = db.transaction((g: Game, records: GameRecord[]) => {
      this.upsert.run(g.id, g.code, g.hostEmail, g.phase === "ended" ? 1 : 0, JSON.stringify(g), Date.now());
      for (const r of records) {
        // A taken-back "Next question" removes what it had filed, in order, so the question is filed afresh when the host moves on again.
        if (r.kind === "retract") {
          const d = r.data as { number: number; theme: boolean };
          db.prepare("DELETE FROM game_records WHERE game_id = ? AND ((kind = 'question' AND json_extract(data, '$.number') = ?) OR (kind = 'theme' AND ? = 1))").run(g.id, d.number, d.theme ? 1 : 0);
        } else this.addRecord.run(g.id, r.at, r.kind, JSON.stringify(r.data));
      }
    });
    this.prune();
    for (const row of db.prepare("SELECT id, state FROM games").iterate() as IterableIterator<{ id: string; state: string }>) {
      let g: Game;
      try {
        g = reviveGame(JSON.parse(row.state));
      } catch (e) {
        // One bad row must not stop the server: skip it, say so, and leave it in the database for a look.
        this.unreadable.push(row.id);
        console.error(`stored game ${row.id} could not be loaded and was skipped: ${(e as Error).message}`);
        continue;
      }
      if (this.stale(g)) {
        this.archived.set(g.id, summarize(g));
        continue;
      }
      this.games.set(g.id, g);
      if (g.phase !== "ended") this.byCode.set(g.code, g.id);
      this.arm(g); // a question that ran out of time while the server was down closes straight away
    }
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref?.();
  }

  private stale = (g: Game) => g.phase === "ended" && (g.endedAt ?? 0) < Date.now() - KEEP_ENDED_MS;

  private prune(): void {
    if (this.retentionDays <= 0) return;
    const before = Date.now() - this.retentionDays * 24 * 3600 * 1000;
    const gone = this.db.transaction(() => {
      const rows = this.db.prepare("DELETE FROM games WHERE ended = 1 AND updated_at < ? RETURNING id, code, host_email").all(before) as { id: string; code: string; host_email: string }[];
      for (const r of rows) {
        this.db.prepare("DELETE FROM game_records WHERE game_id = ?").run(r.id);
        // The audit log keeps the fact that it existed and when it went.
        this.db.prepare("INSERT INTO audit (at, actor, action, target, detail) VALUES (?, 'system', 'session.purged', ?, ?)").run(Date.now(), `session:${r.id}`, JSON.stringify({ code: r.code, host: r.host_email, olderThanDays: this.retentionDays }));
      }
      return rows;
    })();
    for (const { id } of gone) {
      this.games.delete(id);
      this.archived.delete(id);
    }
  }

  /** Moves finished games out of memory once nobody is likely to be looking, and applies the retention setting. */
  sweep(): void {
    for (const g of this.games.values()) {
      if (!this.stale(g)) continue;
      this.games.delete(g.id);
      this.archived.set(g.id, summarize(g));
    }
    this.prune();
  }

  /** Closes the open question when its deadline passes, even if nobody has the page open. */
  private arm(g: Game): void {
    clearTimeout(this.timers.get(g.id));
    this.timers.delete(g.id);
    if (g.phase !== "open" || !g.deadline) return;
    const deadline = g.deadline;
    const t = setTimeout(() => this.timeUp(g.id, deadline), Math.max(0, deadline - Date.now()) + 50);
    t.unref?.();
    this.timers.set(g.id, t);
  }

  private timeUp(id: string, deadline: number): void {
    const g = this.games.get(id);
    if (!g || g.phase !== "open" || g.deadline !== deadline) return; // moved on or extended in the meantime
    try {
      act(g, { action: "close" });
    } catch {
      return; // nothing to close after all; a timer must never take the server down
    }
    this.save(g);
  }

  get = (id: string): Game | undefined => {
    const g = this.games.get(id);
    if (g || !this.archived.has(id)) return g;
    const row = this.readState.get(id) as { state: string } | undefined;
    if (!row) return undefined;
    try {
      return reviveGame(JSON.parse(row.state));
    } catch {
      return undefined;
    }
  };
  getByCode = (code: string) => {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.games.get(id) : undefined;
  };
  /** Every game, newest first, as summaries. */
  list = (): GameSummary[] => [...[...this.games.values()].map(summarize), ...this.archived.values()].sort((a, b) => b.createdAt - a.createdAt);
  activeCountFor = (email: string) => {
    let n = 0;
    for (const g of this.games.values()) if (g.hostEmail === email && g.phase !== "ended") n++;
    return n;
  };

  newCode(): string {
    for (;;) {
      const c = makeCode();
      if (!this.byCode.has(c)) return c;
    }
  }

  save(g: Game): void {
    this.games.set(g.id, g);
    this.archived.delete(g.id);
    if (g.phase === "ended") this.byCode.delete(g.code);
    else this.byCode.set(g.code, g.id);
    this.write(g, takeRecords(g));
    this.arm(g);
    this.bus.emit(g.id);
  }

  /** The permanent record of a game: one entry per finished question, and one for the theme. Oldest first. */
  records(id: string): (GameRecord & { id: number })[] {
    return (this.db.prepare("SELECT id, at, kind, data FROM game_records WHERE game_id = ? ORDER BY id").all(id) as { id: number; at: number; kind: GameRecord["kind"]; data: string }[])
      .map((r) => ({ id: r.id, at: r.at, kind: r.kind, data: JSON.parse(r.data) }));
  }

  /** How many games are held in full, and how many only as a summary. */
  get counts() {
    return { inMemory: this.games.size, archived: this.archived.size };
  }

  /** Stops every timer, for a clean shutdown. */
  close(): void {
    clearInterval(this.sweeper);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
