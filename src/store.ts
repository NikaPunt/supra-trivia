import { EventEmitter } from "node:events";
import type { Db } from "./db.js";
import { act, makeCode, type Game } from "./game.js";

/** Live games held in memory and written through to SQLite on every change, so a restart loses nothing. */
export class GameStore {
  private games = new Map<string, Game>();
  private byCode = new Map<string, string>();
  /** Emits `game.id` whenever that game changes; SSE connections listen on it. */
  readonly bus = new EventEmitter().setMaxListeners(1000);

  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private db: Db) {
    for (const row of db.prepare("SELECT state FROM games").all() as { state: string }[]) {
      const g = JSON.parse(row.state) as Game;
      this.games.set(g.id, g);
      if (g.phase !== "ended") this.byCode.set(g.code, g.id);
      this.arm(g); // a question that ran out of time while the server was down closes straight away
    }
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
    act(g, { action: "close" });
    this.save(g);
  }

  get = (id: string) => this.games.get(id);
  getByCode = (code: string) => {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.games.get(id) : undefined;
  };
  list = () => [...this.games.values()].sort((a, b) => b.createdAt - a.createdAt);
  activeCountFor = (email: string) => this.list().filter((g) => g.hostEmail === email && g.phase !== "ended").length;

  newCode(): string {
    for (;;) {
      const c = makeCode();
      if (!this.byCode.has(c)) return c;
    }
  }

  save(g: Game): void {
    this.games.set(g.id, g);
    if (g.phase === "ended") this.byCode.delete(g.code);
    else this.byCode.set(g.code, g.id);
    this.db
      .prepare("INSERT INTO games (id, code, host_email, ended, state, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ended = excluded.ended, state = excluded.state, updated_at = excluded.updated_at")
      .run(g.id, g.code, g.hostEmail, g.phase === "ended" ? 1 : 0, JSON.stringify(g), Date.now());
    this.arm(g);
    this.bus.emit(g.id);
  }
}
