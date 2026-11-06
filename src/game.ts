import { randomBytes, randomUUID } from "node:crypto";
import { getModule, type Rounds } from "./modules/index.js";

export type Phase = "lobby" | "open" | "closed" | "revealed" | "ended";
export type AnswerStatus = "pending" | "approved" | "rejected";

export interface Answer {
  id: string;
  playerId: string;
  value: unknown;
  status: AnswerStatus;
  points: number;
  at: number;
}
export interface Player {
  id: string;
  nickname: string;
  joinedAt: number;
  kicked: boolean;
}
export interface Game {
  id: string;
  code: string;
  hostEmail: string;
  triviaId: string;
  title: string;
  /** Snapshot taken at start, so editing the trivia never changes a running session. */
  rounds: Rounds;
  phase: Phase;
  /** Guesses per player per question (0 = unlimited). A question can override it. */
  maxGuesses: number;
  /** Index into the flattened list of items; -1 in the lobby. */
  cursor: number;
  players: Player[];
  /**
   * Answers for the CURRENT item only. They are scored into `scores` and cleared when the host moves on,
   * so live state never grows with the number of questions or guesses (BUG-001 in docs/BUGS.md).
   */
  answers: Answer[];
  /** Guesses each player has used on the CURRENT item; cleared with `answers`. */
  attempts: Record<string, number>;
  scores: Record<string, number>;
  history: { cursor: number; type: string; points: Record<string, number> }[];
  createdAt: number;
  endedAt: number | null;
}

export type Action =
  | { action: "begin" | "close" | "reopen" | "reveal" | "next" | "end" }
  | { action: "kick"; playerId: string }
  /** Host sets the points for an answer by hand: full, half, none, or any amount in halves. */
  | { action: "review"; answerId: string; points: number };

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_PLAYERS = 100;
/** Hard ceiling when a host picks "unlimited", so live state can never grow without bound. */
export const UNLIMITED_CAP = 20;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";

export const makeCode = () => [...randomBytes(5)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

export interface Item {
  roundTitle: string;
  type: string;
  config: any;
  maxGuesses?: number;
}
export const items = (g: Pick<Game, "rounds">): Item[] =>
  g.rounds.flatMap((r) => r.modules.map((m) => ({ roundTitle: r.title, type: m.type, config: m.config, maxGuesses: m.maxGuesses })));
export const currentItem = (g: Game): Item | null => (g.cursor >= 0 ? (items(g)[g.cursor] ?? null) : null);

export function newGame(o: { hostEmail: string; triviaId: string; title: string; rounds: Rounds; code: string; maxGuesses: number }): Game {
  if (items(o).length === 0) throw new GameError("this trivia has no questions yet");
  return {
    id: randomUUID(), code: o.code, hostEmail: o.hostEmail, triviaId: o.triviaId, title: o.title,
    rounds: o.rounds, maxGuesses: o.maxGuesses, phase: "lobby", cursor: -1, players: [], answers: [], attempts: {}, scores: {}, history: [],
    createdAt: Date.now(), endedAt: null,
  };
}

export function addPlayer(g: Game, rawNickname: string): Player {
  if (g.phase === "ended") throw new GameError("this session has ended", 409);
  const nickname = rawNickname.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _.'-]{1,24}$/u.test(nickname)) throw new GameError("nickname must be 1-24 letters, numbers or spaces");
  if (g.players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) throw new GameError("that nickname is taken", 409);
  if (g.players.length >= MAX_PLAYERS) throw new GameError("this session is full", 409);
  const p: Player = { id: randomUUID(), nickname, joinedAt: Date.now(), kicked: false };
  g.players.push(p);
  return p;
}

/** 0 means unlimited. A per-question setting beats the session default. */
export const guessLimit = (g: Game, it: Item) => it.maxGuesses ?? g.maxGuesses;

export function submit(g: Game, playerId: string, value: unknown): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.kicked) throw new GameError("you are not in this session", 403);
  if (g.phase !== "open") throw new GameError("answers are closed", 409);
  const it = currentItem(g)!;
  const mod = getModule(it.type)!;
  const parsed = mod.answerSchema.safeParse(value);
  if (!parsed.success) throw new GameError("invalid answer");
  const limit = guessLimit(g, it);
  const used = g.attempts[playerId] ?? 0;
  if (used >= (limit || UNLIMITED_CAP)) throw new GameError("you are out of guesses for this question", 429);
  const same = (a: Answer) => JSON.stringify(a.value) === JSON.stringify(parsed.data);
  const mine = g.answers.filter((a) => a.playerId === playerId);
  if (mine.some(same)) throw new GameError("you already gave that answer");
  // Single-answer questions: a new answer replaces the old one but still uses a guess.
  if (!mod.input.multi) g.answers = g.answers.filter((a) => a.playerId !== playerId);
  g.attempts[playerId] = used + 1;
  g.answers.push({ id: randomUUID(), playerId, value: parsed.data, status: "pending", points: 0, at: Date.now() });
}

function scorePending(g: Game): void {
  const it = currentItem(g);
  if (!it) return;
  const mod = getModule(it.type)!;
  const pending = g.answers.filter((a) => a.status === "pending");
  if (!pending.length) return;
  const all = mod.scoreAll?.(it.config, pending.map((a) => ({ playerId: a.playerId, value: a.value })));
  for (const a of pending) {
    a.points = all ? (all.get(a.playerId) ?? 0) : mod.score(it.config, a.value);
    a.status = a.points > 0 ? "approved" : "rejected";
  }
}

/** A player earns the best approved answer for the item, so several approved guesses never stack. */
export function itemPoints(g: Game): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of g.answers) if (a.status === "approved") m.set(a.playerId, Math.max(m.get(a.playerId) ?? 0, a.points));
  return m;
}

function finishItem(g: Game): void {
  scorePending(g);
  const pts = itemPoints(g);
  for (const [pid, p] of pts) g.scores[pid] = (g.scores[pid] ?? 0) + p;
  g.history.push({ cursor: g.cursor, type: currentItem(g)?.type ?? "", points: Object.fromEntries(pts) });
  g.answers = [];
  g.attempts = {};
}

const inPlay = (g: Game) => g.phase === "open" || g.phase === "closed" || g.phase === "revealed";
const need = (ok: boolean, msg: string) => {
  if (!ok) throw new GameError(msg, 409);
};

export function act(g: Game, a: Action): void {
  switch (a.action) {
    case "begin":
      need(g.phase === "lobby", "already started");
      g.cursor = 0;
      g.phase = "open";
      break;
    case "close":
      need(g.phase === "open", "question is not open");
      g.phase = "closed";
      break;
    case "reopen":
      need(g.phase === "closed", "question is not closed");
      g.phase = "open";
      break;
    case "reveal":
      need(g.phase === "open" || g.phase === "closed", "nothing to reveal");
      scorePending(g);
      g.phase = "revealed";
      break;
    case "next":
      need(inPlay(g), "session is not running");
      finishItem(g);
      if (g.cursor + 1 < items(g).length) {
        g.cursor++;
        g.phase = "open";
      } else {
        g.phase = "ended";
        g.endedAt = Date.now();
      }
      break;
    case "end":
      need(g.phase !== "ended", "already ended");
      if (inPlay(g)) finishItem(g);
      g.phase = "ended";
      g.endedAt = Date.now();
      break;
    case "kick": {
      const p = g.players.find((x) => x.id === a.playerId);
      if (!p) throw new GameError("no such player", 404);
      p.kicked = true;
      g.answers = g.answers.filter((x) => x.playerId !== p.id);
      delete g.scores[p.id];
      delete g.attempts[p.id];
      break;
    }
    case "review": {
      need(inPlay(g), "session is not running");
      const ans = g.answers.find((x) => x.id === a.answerId);
      if (!ans) throw new GameError("no such answer", 404);
      ans.points = a.points;
      ans.status = a.points > 0 ? "approved" : "rejected";
      break;
    }
  }
}

// ---- views: what each audience is allowed to see ----

function ranking(g: Game, includeCurrent: boolean) {
  const pts = includeCurrent ? itemPoints(g) : new Map<string, number>();
  return g.players
    .filter((p) => !p.kicked)
    .map((p) => ({ id: p.id, nickname: p.nickname, points: (g.scores[p.id] ?? 0) + (pts.get(p.id) ?? 0) }))
    .sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname));
}

function itemMeta(g: Game, full: boolean) {
  const it = currentItem(g);
  if (!it || !inPlay(g)) return null;
  const mod = getModule(it.type)!;
  return {
    type: it.type,
    label: mod.label,
    round: it.roundTitle,
    input: mod.input,
    public: mod.publicView(it.config),
    ...(full || g.phase === "revealed" ? { solution: mod.solution(it.config) } : {}),
    ...(full ? { config: it.config, points: mod.points(it.config), maxGuesses: it.maxGuesses ?? null } : {}),
  };
}

const showBoard = (g: Game) => g.phase === "revealed" || g.phase === "ended";
const base = (g: Game) => ({
  code: g.code, title: g.title, phase: g.phase, number: g.cursor + 1, total: items(g).length,
  players: g.players.filter((p) => !p.kicked).length,
});

function guessesLeft(g: Game, playerId: string): number | null {
  const it = currentItem(g);
  const limit = it ? guessLimit(g, it) : 0;
  return it && limit > 0 ? Math.max(0, limit - (g.attempts[playerId] ?? 0)) : null;
}

export function playerView(g: Game, playerId: string) {
  const board = showBoard(g) ? ranking(g, g.phase === "revealed") : null;
  const rank = board ? board.findIndex((r) => r.id === playerId) + 1 : null;
  return {
    ...base(g),
    item: itemMeta(g, false),
    me: g.players.find((p) => p.id === playerId)?.nickname ?? "",
    // Only this player's own answers for the current item ever leave the server.
    // Whether an answer was right, and what it earned, stays hidden until the reveal (BUG-002 in docs/BUGS.md).
    myAnswers: g.answers
      .filter((a) => a.playerId === playerId)
      .map((a) => ({ value: a.value, ...(g.phase === "revealed" ? { status: a.status, points: a.points } : {}) })),
    guessesLeft: guessesLeft(g, playerId),
    leaderboard: board?.slice(0, 10).map((r) => ({ nickname: r.nickname, points: r.points, me: r.id === playerId })) ?? null,
    myRank: rank || null,
  };
}

export function deckView(g: Game) {
  const board = showBoard(g) ? ranking(g, g.phase === "revealed") : null;
  return {
    ...base(g),
    item: itemMeta(g, false),
    answered: new Set(g.answers.map((a) => a.playerId)).size,
    leaderboard: board?.slice(0, 10).map((r) => ({ nickname: r.nickname, points: r.points })) ?? null,
  };
}

export function hostView(g: Game) {
  const nick = new Map(g.players.map((p) => [p.id, p.nickname]));
  const answered = new Set(g.answers.map((a) => a.playerId));
  return {
    ...base(g),
    id: g.id,
    hostEmail: g.hostEmail,
    maxGuesses: g.maxGuesses,
    item: itemMeta(g, true),
    playerList: g.players.map((p) => ({ id: p.id, nickname: p.nickname, kicked: p.kicked, answered: answered.has(p.id) })),
    answers: g.answers.map((a) => ({
      id: a.id, playerId: a.playerId, nickname: nick.get(a.playerId) ?? "?", value: a.value, status: a.status, points: a.points,
    })),
    leaderboard: ranking(g, g.phase === "revealed").map((r) => ({ id: r.id, nickname: r.nickname, points: r.points })),
  };
}
