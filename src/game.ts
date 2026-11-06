import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { getModule, type Rounds } from "./modules/index.js";
import { normalize } from "./modules/types.js";

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
  /** Optional 4-digit PIN so a player (or team) can get back in if their phone locks or reloads. */
  pin?: { salt: string; hash: string };
  pinFails: number;
}
export interface ThemeGuess {
  id: string;
  playerId: string;
  text: string;
  /** Question number when the guess was made; earlier guesses are worth more. */
  atNumber: number;
  status: AnswerStatus;
  points: number;
}
export interface Theme {
  secret: string;
  hint: string;
  formal: string;
}
export interface Game {
  id: string;
  code: string;
  hostEmail: string;
  triviaId: string;
  title: string;
  /** Snapshot taken at start, so editing the trivia never changes a running session. */
  rounds: Rounds;
  /** Guesses per player per question (0 = unlimited). A question can override it. */
  maxGuesses: number;
  phase: Phase;
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
  /** Stake values already spent per pool per player (confidence sets). */
  poolUsed: Record<string, Record<string, number[]>>;
  scores: Record<string, number>;
  /** The secret overall theme, if the trivia has one. */
  theme: Theme | null;
  themeRevealed: boolean;
  /** Pending theme guesses. Capped per player, and cleared when the theme is revealed. */
  themeGuesses: ThemeGuess[];
  /** Bonus earned for guessing the theme; counts towards totals only once the theme is revealed. */
  themeBonus: Record<string, number>;
  history: { cursor: number; type: string; points: Record<string, number> }[];
  createdAt: number;
  endedAt: number | null;
}

export type Action =
  | { action: "begin" | "close" | "reopen" | "reveal" | "next" | "end" | "theme_reveal" }
  | { action: "kick"; playerId: string }
  /** Host sets the points for an answer by hand: full, half, none, a lost wager, or any amount in halves. */
  | { action: "review"; answerId: string; points: number }
  | { action: "theme_review"; guessId: string; points: number };

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_PLAYERS = 100;
/** Hard ceiling when a host picks "unlimited", so live state can never grow without bound. */
export const UNLIMITED_CAP = 20;
export const MAX_THEME_GUESSES = 5;
const MAX_PIN_FAILS = 10;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";

export const makeCode = () => [...randomBytes(5)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

export interface Item {
  roundIdx: number;
  roundTitle: string;
  roundSubtitle?: string;
  section?: string;
  type: string;
  config: any;
  maxGuesses?: number;
}
export const items = (g: Pick<Game, "rounds">): Item[] =>
  g.rounds.flatMap((r, roundIdx) =>
    r.modules.map((m) => ({ roundIdx, roundTitle: r.title, roundSubtitle: r.subtitle, section: m.section, type: m.type, config: m.config, maxGuesses: m.maxGuesses })),
  );
export const currentItem = (g: Game): Item | null => (g.cursor >= 0 ? (items(g)[g.cursor] ?? null) : null);

/** True when the current question is the last one of its round: the moment for a leaderboard. */
export function isRoundEnd(g: Game): boolean {
  const all = items(g);
  const cur = all[g.cursor];
  return !!cur && all[g.cursor + 1]?.roundIdx !== cur.roundIdx;
}

export function newGame(o: { hostEmail: string; triviaId: string; title: string; rounds: Rounds; code: string; maxGuesses: number; theme?: Theme }): Game {
  if (items(o).length === 0) throw new GameError("this trivia has no questions yet");
  return {
    id: randomUUID(), code: o.code, hostEmail: o.hostEmail, triviaId: o.triviaId, title: o.title,
    rounds: o.rounds, maxGuesses: o.maxGuesses, phase: "lobby", cursor: -1, players: [], answers: [], attempts: {},
    poolUsed: {}, scores: {}, theme: o.theme ?? null, themeRevealed: false, themeGuesses: [], themeBonus: {},
    history: [], createdAt: Date.now(), endedAt: null,
  };
}

// ---- joining ----

const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString("hex");
const pinOk = (p: Player, pin: string) =>
  !!p.pin && timingSafeEqual(Buffer.from(hashPin(pin, p.pin.salt), "hex"), Buffer.from(p.pin.hash, "hex"));

/** Adds a player, or lets an existing one back in when the name and PIN match. */
export function joinPlayer(g: Game, rawNickname: string, pin?: string): { player: Player; rejoined: boolean } {
  if (g.phase === "ended") throw new GameError("this session has ended", 409);
  const nickname = rawNickname.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _.'-]{1,24}$/u.test(nickname)) throw new GameError("name must be 1-24 letters, numbers or spaces");
  if (pin !== undefined && pin !== "" && !/^\d{4}$/.test(pin)) throw new GameError("PIN must be 4 digits");

  const existing = g.players.find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
  if (existing) {
    if (existing.kicked) throw new GameError("you were removed from this session", 403);
    if (!existing.pin) throw new GameError("that name is taken", 409);
    if (existing.pinFails >= MAX_PIN_FAILS) throw new GameError("too many wrong PINs for that name; pick another name", 429);
    if (!pin || !pinOk(existing, pin)) {
      existing.pinFails++;
      throw new GameError("that name is taken. Enter its PIN to get back in", 409);
    }
    existing.pinFails = 0;
    return { player: existing, rejoined: true };
  }
  if (g.players.length >= MAX_PLAYERS) throw new GameError("this session is full", 409);
  const player: Player = { id: randomUUID(), nickname, joinedAt: Date.now(), kicked: false, pinFails: 0 };
  if (pin) {
    const salt = randomBytes(8).toString("hex");
    player.pin = { salt, hash: hashPin(pin, salt) };
  }
  g.players.push(player);
  return { player, rejoined: false };
}

// ---- answering ----

/** 0 means unlimited. A per-question setting beats the session default. */
export const guessLimit = (g: Game, it: Item) => it.maxGuesses ?? g.maxGuesses;

const stakeFor = (g: Game, it: Item, playerId: string) => {
  const mod = getModule(it.type)!;
  const pool = mod.pool?.(it.config);
  return mod.stake?.(it.config, pool ? (g.poolUsed[pool]?.[playerId] ?? []) : []);
};

export function submit(g: Game, playerId: string, value: unknown): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.kicked) throw new GameError("you are not in this session", 403);
  if (g.phase !== "open") throw new GameError("answers are closed", 409);
  const it = currentItem(g)!;
  const mod = getModule(it.type)!;
  const parsed = mod.answerSchema.safeParse(value);
  if (!parsed.success) throw new GameError("invalid answer");

  const st = stakeFor(g, it, playerId);
  if (st) {
    const v = (parsed.data as Record<string, unknown>)[st.key];
    const valid = typeof v === "number" && (st.options ? st.options.includes(v) : v >= (st.min ?? 0) && v <= (st.max ?? Infinity));
    if (!valid) throw new GameError(`choose a valid value for: ${st.label}`);
  }

  const limit = guessLimit(g, it);
  const used = g.attempts[playerId] ?? 0;
  if (used >= (limit || UNLIMITED_CAP)) throw new GameError("you are out of guesses for this question", 429);
  const same = (a: Answer) => JSON.stringify(a.value) === JSON.stringify(parsed.data);
  if (g.answers.some((a) => a.playerId === playerId && same(a))) throw new GameError("you already gave that answer");
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

/** A player's result for the item is their best scored answer, so several guesses never stack. A lost wager counts below zero. */
export function itemPoints(g: Game): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of g.answers) if (a.status !== "pending") m.set(a.playerId, Math.max(m.get(a.playerId) ?? -Infinity, a.points));
  return m;
}

function finishItem(g: Game): void {
  scorePending(g);
  const it = currentItem(g)!;
  const mod = getModule(it.type)!;
  const pool = mod.pool?.(it.config);
  const pts = itemPoints(g);
  for (const [pid, p] of pts) g.scores[pid] = (g.scores[pid] ?? 0) + p;
  if (pool && mod.stake) {
    // Whatever each player staked on their final answer is spent for the rest of the pool.
    const key = mod.stake(it.config, []).key;
    for (const a of g.answers) {
      const v = (a.value as Record<string, unknown>)[key];
      if (typeof v === "number") ((g.poolUsed[pool] ??= {})[a.playerId] ??= []).push(v);
    }
  }
  g.history.push({ cursor: g.cursor, type: it.type, points: Object.fromEntries(pts) });
  g.answers = [];
  g.attempts = {};
}

// ---- the secret overall theme ----

/** Earlier guesses earn more: 4 points at question 1 down to 1 from question 4 on. */
export const suggestedThemePoints = (atNumber: number) => Math.max(1, 5 - atNumber);

export function submitTheme(g: Game, playerId: string, rawText: string): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.kicked) throw new GameError("you are not in this session", 403);
  if (!g.theme) throw new GameError("this trivia has no secret theme", 409);
  if (g.themeRevealed) throw new GameError("the theme has been revealed", 409);
  if (g.phase === "lobby" || g.phase === "ended") throw new GameError("theme guesses open once the game starts", 409);
  const text = rawText.trim().slice(0, 200);
  if (!text) throw new GameError("enter a guess");
  const mine = g.themeGuesses.filter((t) => t.playerId === playerId);
  if (mine.length >= MAX_THEME_GUESSES) throw new GameError(`at most ${MAX_THEME_GUESSES} theme guesses each`, 429);
  if (mine.some((t) => normalize(t.text) === normalize(text))) throw new GameError("you already guessed that");
  g.themeGuesses.push({ id: randomUUID(), playerId, text, atNumber: g.cursor + 1, status: "pending", points: 0 });
}

/** Reveals the theme: guesses turn into bonus points (best guess per player) and the guess list is cleared. */
function revealTheme(g: Game): void {
  if (!g.theme || g.themeRevealed) return;
  for (const t of g.themeGuesses) {
    if (t.status !== "pending" && t.points > 0) g.themeBonus[t.playerId] = Math.max(g.themeBonus[t.playerId] ?? 0, t.points);
  }
  g.themeGuesses = [];
  g.themeRevealed = true;
}

// ---- host actions ----

const inPlay = (g: Game) => g.phase === "open" || g.phase === "closed" || g.phase === "revealed";
const need = (ok: boolean, msg: string) => {
  if (!ok) throw new GameError(msg, 409);
};

function finishGame(g: Game): void {
  revealTheme(g);
  g.phase = "ended";
  g.endedAt = Date.now();
}

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
      } else finishGame(g);
      break;
    case "end":
      need(g.phase !== "ended", "already ended");
      if (inPlay(g)) finishItem(g);
      finishGame(g);
      break;
    case "kick": {
      const p = g.players.find((x) => x.id === a.playerId);
      if (!p) throw new GameError("no such player", 404);
      p.kicked = true;
      g.answers = g.answers.filter((x) => x.playerId !== p.id);
      g.themeGuesses = g.themeGuesses.filter((x) => x.playerId !== p.id);
      delete g.scores[p.id];
      delete g.themeBonus[p.id];
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
    case "theme_review": {
      need(!!g.theme && !g.themeRevealed, "no theme to review");
      const t = g.themeGuesses.find((x) => x.id === a.guessId);
      if (!t) throw new GameError("no such guess", 404);
      t.points = a.points;
      t.status = a.points > 0 ? "approved" : "rejected";
      break;
    }
    case "theme_reveal":
      need(!!g.theme && !g.themeRevealed, "no theme to reveal");
      revealTheme(g);
      break;
  }
}

// ---- views: what each audience is allowed to see ----

function ranking(g: Game, includeCurrent: boolean) {
  const pts = includeCurrent ? itemPoints(g) : new Map<string, number>();
  return g.players
    .filter((p) => !p.kicked)
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      points: (g.scores[p.id] ?? 0) + (pts.get(p.id) ?? 0) + (g.themeRevealed ? (g.themeBonus[p.id] ?? 0) : 0),
    }))
    .sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname));
}

function itemMeta(g: Game, full: boolean) {
  const it = currentItem(g);
  if (!it || !inPlay(g)) return null;
  const mod = getModule(it.type)!;
  const revealed = full || g.phase === "revealed";
  return {
    type: it.type,
    label: mod.label,
    round: it.roundTitle,
    roundSubtitle: it.roundSubtitle,
    section: it.section,
    input: mod.input,
    stakeKey: mod.stake?.(it.config, [])?.key,
    public: mod.publicView(it.config),
    ...(revealed ? { solution: mod.solution(it.config), funFact: it.config.funFact } : {}),
    ...(full ? { config: it.config, points: mod.points(it.config), maxGuesses: it.maxGuesses ?? null } : {}),
  };
}

/** Leaderboards appear at the end of each round and at the end of the game, never after every question. */
const showBoard = (g: Game) => g.phase === "ended" || (g.phase === "revealed" && isRoundEnd(g));

const base = (g: Game) => ({
  code: g.code, title: g.title, phase: g.phase, number: g.cursor + 1, total: items(g).length,
  players: g.players.filter((p) => !p.kicked).length,
});

function guessesLeft(g: Game, playerId: string): number | null {
  const it = currentItem(g);
  const limit = it ? guessLimit(g, it) : 0;
  return it && limit > 0 ? Math.max(0, limit - (g.attempts[playerId] ?? 0)) : null;
}

const themePublic = (g: Game) =>
  g.theme ? { hint: g.theme.hint, revealed: g.themeRevealed, ...(g.themeRevealed ? { secret: g.theme.secret, formal: g.theme.formal } : {}) } : null;

export function playerView(g: Game, playerId: string) {
  const board = showBoard(g) ? ranking(g, g.phase === "revealed") : null;
  const it = currentItem(g);
  const st = it && inPlay(g) ? stakeFor(g, it, playerId) : undefined;
  const mine = g.themeGuesses.filter((t) => t.playerId === playerId);
  return {
    ...base(g),
    item: itemMeta(g, false),
    stake: st ?? null,
    me: g.players.find((p) => p.id === playerId)?.nickname ?? "",
    // Only this player's own answers for the current item ever leave the server.
    // Whether an answer was right, and what it earned, stays hidden until the reveal (BUG-002 in docs/BUGS.md).
    myAnswers: g.answers
      .filter((a) => a.playerId === playerId)
      .map((a) => ({ value: a.value, ...(g.phase === "revealed" ? { status: a.status, points: a.points } : {}) })),
    guessesLeft: guessesLeft(g, playerId),
    theme: g.theme && {
      ...themePublic(g),
      myGuesses: mine.map((t) => t.text),
      guessesLeft: g.themeRevealed ? 0 : MAX_THEME_GUESSES - mine.length,
      myBonus: g.themeRevealed ? (g.themeBonus[playerId] ?? 0) : null,
    },
    leaderboard: board?.slice(0, 10).map((r) => ({ nickname: r.nickname, points: r.points, me: r.id === playerId })) ?? null,
    myRank: board ? board.findIndex((r) => r.id === playerId) + 1 || null : null,
  };
}

export function deckView(g: Game) {
  const board = showBoard(g) ? ranking(g, g.phase === "revealed") : null;
  return {
    ...base(g),
    item: itemMeta(g, false),
    theme: themePublic(g),
    answered: new Set(g.answers.map((a) => a.playerId)).size,
    leaderboard: board?.slice(0, 10).map((r) => ({ nickname: r.nickname, points: r.points })) ?? null,
  };
}

export function hostView(g: Game) {
  const nick = new Map(g.players.map((p) => [p.id, p.nickname]));
  const answered = new Set(g.answers.map((a) => a.playerId));
  const it = currentItem(g);
  const mod = it && inPlay(g) ? getModule(it.type)! : null;
  return {
    ...base(g),
    id: g.id,
    hostEmail: g.hostEmail,
    maxGuesses: g.maxGuesses,
    item: itemMeta(g, true),
    roundEnd: inPlay(g) ? isRoundEnd(g) : false,
    playerList: g.players.map((p) => ({ id: p.id, nickname: p.nickname, kicked: p.kicked, answered: answered.has(p.id), hasPin: !!p.pin })),
    answers: g.answers.map((a) => ({
      id: a.id, playerId: a.playerId, nickname: nick.get(a.playerId) ?? "?", value: a.value, status: a.status, points: a.points,
      // What each button awards. Stakes make "Right" and "Wrong" depend on the answer.
      full: mod!.fullPoints?.(it!.config, a.value) ?? mod!.points(it!.config),
      wrong: mod!.wrongPoints?.(it!.config, a.value) ?? 0,
      suggest: mod!.scoreAll ? null : mod!.score(it!.config, a.value),
    })),
    theme: g.theme && {
      secret: g.theme.secret, hint: g.theme.hint, formal: g.theme.formal, revealed: g.themeRevealed,
      guesses: g.themeGuesses.map((t) => ({
        id: t.id, nickname: nick.get(t.playerId) ?? "?", text: t.text, atNumber: t.atNumber, status: t.status, points: t.points,
        suggested: suggestedThemePoints(t.atNumber),
      })),
      bonuses: g.themeRevealed ? Object.entries(g.themeBonus).map(([pid, points]) => ({ nickname: nick.get(pid) ?? "?", points })) : [],
    },
    leaderboard: ranking(g, g.phase === "revealed").map((r) => ({ id: r.id, nickname: r.nickname, points: r.points })),
  };
}
