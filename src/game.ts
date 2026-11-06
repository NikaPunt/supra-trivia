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
  /** Which phone sent it, so teammates can see who guessed what. */
  device?: string;
  status: AnswerStatus;
  points: number;
}
/** One guess a team made on the current question. Kept so teammates can see what has already been tried. */
export interface GuessEntry {
  playerId: string;
  value: unknown;
  at: number;
  /** Which phone sent it (a random id each phone makes up), so a screen can say "you" or "a teammate". */
  device?: string;
}
export interface Theme {
  secret: string;
  hint: string;
  formal: string;
  /** Points for an approved guess at question 1. Games saved before this setting existed use 4. */
  bonus?: number;
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
  /** Seconds per question before answers close by themselves (0 = no timer). A question can override it. Absent in older games: no timer. */
  timeLimit?: number;
  /** When the open question closes by itself, as epoch milliseconds. Null when there is no timer running (or it is paused). */
  deadline?: number | null;
  /** For a two-step question (Final Jeopardy): the host has shown the question, so players can answer. */
  clueShown?: boolean;
  /** For a two-step question: the wager each player has locked in on the category alone. Cleared with the question. */
  wagers?: Record<string, number>;
  /** The host has paused the open question: the clock is frozen and answers are refused. */
  paused?: boolean;
  /** Milliseconds that were left on the clock when it was paused, or null if the question has no timer. */
  pausedLeft?: number | null;
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
  /** Every guess made on the CURRENT item, in order. Cleared with `answers`, and capped by the guess limit. */
  guessLog: GuessEntry[];
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
  | { action: "begin" | "close" | "reopen" | "reveal" | "next" | "end" | "theme_reveal" | "pause" | "resume" | "showclue" }
  /** Gives the open question more time. */
  | { action: "extend"; seconds?: number }
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
  section?: string;
  type: string;
  config: any;
  maxGuesses?: number;
  /** Seconds players get on this question; 0 means no timer. Beats the session default. */
  timeLimit?: number;
}
export const items = (g: Pick<Game, "rounds">): Item[] =>
  g.rounds.flatMap((r, roundIdx) =>
    r.modules.map((m) => ({ roundIdx, roundTitle: r.title, section: m.section, type: m.type, config: m.config, maxGuesses: m.maxGuesses, timeLimit: m.timeLimit })),
  );
export const currentItem = (g: Game): Item | null => (g.cursor >= 0 ? (items(g)[g.cursor] ?? null) : null);

/**
 * Where the current question sits within its run: consecutive questions of the same round and section count together,
 * so six Hodgepodge questions read 1/6 to 6/6 and a four-question confidence set reads 1/4 to 4/4.
 */
export function groupPos(g: Game): { n: number; of: number } {
  const all = items(g);
  const same = (a: Item | undefined, b: Item | undefined) => !!a && !!b && a.roundIdx === b.roundIdx && (a.section ?? "") === (b.section ?? "");
  const cur = all[g.cursor];
  let start = g.cursor;
  while (start > 0 && same(all[start - 1], cur)) start--;
  let end = g.cursor;
  while (end + 1 < all.length && same(all[end + 1], cur)) end++;
  return { n: g.cursor - start + 1, of: end - start + 1 };
}

/** True when the current question is the last one of its round: the moment for a leaderboard. */
export function isRoundEnd(g: Game): boolean {
  const all = items(g);
  const cur = all[g.cursor];
  return !!cur && all[g.cursor + 1]?.roundIdx !== cur.roundIdx;
}

export function newGame(o: { hostEmail: string; triviaId: string; title: string; rounds: Rounds; code: string; maxGuesses: number; timeLimit?: number; theme?: Theme }): Game {
  if (items(o).length === 0) throw new GameError("this trivia has no questions yet");
  return {
    id: randomUUID(), code: o.code, hostEmail: o.hostEmail, triviaId: o.triviaId, title: o.title,
    rounds: o.rounds, maxGuesses: o.maxGuesses, timeLimit: o.timeLimit ?? 0, deadline: null, phase: "lobby", cursor: -1, players: [], answers: [], attempts: {}, guessLog: [],
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

/** The points a team has banked so far (finished questions, plus the theme bonus once it is public). */
const teamScore = (g: Game, playerId: string) => (g.scores[playerId] ?? 0) + (g.themeRevealed ? (g.themeBonus[playerId] ?? 0) : 0);

/** The most this team may wager on the item: the question's own maximum, or, if the question is set to cap by score, its whole points of score (never below 0). */
export const wagerMax = (g: Game, it: Item, playerId: string): number => {
  const two = getModule(it.type)!.twoStep;
  const own = two ? two.max(it.config) : ((getModule(it.type)!.stake?.(it.config, []) ?? {}).max ?? 0);
  return it.config.capByScore === true ? Math.max(0, Math.floor(teamScore(g, playerId))) : own;
};

const stakeFor = (g: Game, it: Item, playerId: string) => {
  const mod = getModule(it.type)!;
  const pool = mod.pool?.(it.config);
  const st = mod.stake?.(it.config, pool ? (g.poolUsed[pool]?.[playerId] ?? []) : []);
  return st && st.key === "wager" ? { ...st, max: wagerMax(g, it, playerId) } : st;
};

export function submit(g: Game, playerId: string, value: unknown, device?: string): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.kicked) throw new GameError("you are not in this session", 403);
  if (g.phase !== "open") throw new GameError("answers are closed", 409);
  if (g.paused) throw new GameError("the game is paused for a moment", 409);
  // The server closes the question when time runs out; this covers the instant before it does.
  if (g.deadline && Date.now() > g.deadline + 1500) throw new GameError("time is up", 409);
  const it = currentItem(g)!;
  const mod = getModule(it.type)!;
  if (mod.twoStep && !g.clueShown) throw new GameError("the question has not been shown yet", 409);
  // For Final Jeopardy the wager was locked in earlier and is kept here; whatever the phone sends for it is ignored.
  const input = mod.twoStep ? { text: (value as { text?: unknown } | null)?.text, wager: g.wagers?.[playerId] ?? 0 } : value;
  const parsed = mod.answerSchema.safeParse(input);
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
  if (g.answers.some((a) => a.playerId === playerId && same(a))) throw new GameError("your team already gave that answer");
  // Single-answer questions: a new answer replaces the old one but still uses a guess.
  if (!mod.input.multi) g.answers = g.answers.filter((a) => a.playerId !== playerId);
  g.attempts[playerId] = used + 1;
  g.answers.push({ id: randomUUID(), playerId, value: parsed.data, status: "pending", points: 0, at: Date.now() });
  (g.guessLog ??= []).push({ playerId, value: parsed.data, at: Date.now(), device });
}

/** Locks in (or changes) a player's wager on a two-step question, before its question is shown. */
export function setWager(g: Game, playerId: string, value: unknown): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.kicked) throw new GameError("you are not in this session", 403);
  const it = currentItem(g);
  const two = twoStepOf(it);
  if (g.phase !== "open" || !it || !two) throw new GameError("there is no wager to place right now", 409);
  if (g.clueShown) throw new GameError("the question is already showing, so wagers are locked", 409);
  if (g.paused) throw new GameError("the game is paused for a moment", 409);
  const max = wagerMax(g, it, playerId);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) throw new GameError(`a wager is a whole number from 0 to ${max}`);
  (g.wagers ??= {})[playerId] = value;
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
  g.guessLog = [];
  g.wagers = {};
  g.clueShown = false;
}

// ---- the secret overall theme ----

/** Finding the theme is worth the same to everyone: no extra points for being early. */
export const suggestedThemePoints = (bonus = 4) => bonus;

export function submitTheme(g: Game, playerId: string, rawText: string, device?: string): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.kicked) throw new GameError("you are not in this session", 403);
  if (!g.theme) throw new GameError("this trivia has no secret theme", 409);
  if (g.themeRevealed) throw new GameError("the theme has been revealed", 409);
  if (g.phase === "lobby" || g.phase === "ended") throw new GameError("theme guesses open once the game starts", 409);
  const text = rawText.trim().slice(0, 200);
  if (!text) throw new GameError("enter a guess");
  const mine = g.themeGuesses.filter((t) => t.playerId === playerId);
  if (mine.length >= MAX_THEME_GUESSES) throw new GameError(`at most ${MAX_THEME_GUESSES} theme guesses each`, 429);
  if (mine.some((t) => normalize(t.text) === normalize(text))) throw new GameError("your team already guessed that");
  g.themeGuesses.push({ id: randomUUID(), playerId, text, atNumber: g.cursor + 1, device, status: "pending", points: 0 });
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

const everyoneGotTheme = (g: Game) => {
  const live = g.players.filter((p) => !p.kicked);
  return live.length > 0 && live.every((p) => g.themeGuesses.some((t) => t.playerId === p.id && t.status === "approved"));
};

// ---- host actions ----

const secondsFor = (g: Game, it: Item) => it.timeLimit ?? g.timeLimit ?? 0;

/** Starts the countdown for the question that has just opened. */
const twoStepOf = (it: Item | null) => (it ? getModule(it.type)?.twoStep : undefined);
/** True once players can see the question: always, except while a two-step question is waiting for its wagers. */
const clueOpen = (g: Game) => !twoStepOf(currentItem(g)) || !!g.clueShown;

/** Resets the per-question state for a question that has just opened. */
function openItem(g: Game): void {
  g.clueShown = !twoStepOf(currentItem(g));
  g.wagers = {};
  startTimer(g);
}

function startTimer(g: Game): void {
  const it = currentItem(g);
  // A two-step question has no clock until its question is shown.
  const s = it && clueOpen(g) ? secondsFor(g, it) : 0;
  g.deadline = s > 0 ? Date.now() + s * 1000 : null;
  g.paused = false;
  g.pausedLeft = null;
}

const inPlay = (g: Game) => g.phase === "open" || g.phase === "closed" || g.phase === "revealed";
const need = (ok: boolean, msg: string) => {
  if (!ok) throw new GameError(msg, 409);
};

function finishGame(g: Game): void {
  g.deadline = null;
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
      openItem(g);
      break;
    // The order is a waterfall: open, close, reveal, next. Each step needs the one before it.
    case "close":
      need(g.phase === "open", "question is not open");
      need(clueOpen(g), "show the question first");
      g.phase = "closed";
      g.deadline = null;
      g.paused = false; // closing also ends a pause
      g.pausedLeft = null;
      break;
    case "showclue":
      need(g.phase === "open" && !!twoStepOf(currentItem(g)), "this question has no wager step");
      need(!g.clueShown, "the question is already shown");
      need(!g.paused, "resume first");
      g.clueShown = true;
      startTimer(g); // the answer clock starts now
      break;
    case "reopen":
      need(g.phase === "closed", "only a closed question can be reopened");
      g.phase = "open";
      startTimer(g);
      break;
    case "reveal":
      need(g.phase === "closed", g.phase === "open" ? "close the answers first" : "nothing to reveal");
      scorePending(g);
      g.phase = "revealed";
      break;
    case "extend": {
      need(g.phase === "open" && (!!g.deadline || (!!g.paused && g.pausedLeft != null)), "no timer is running on this question");
      const add = Math.min(Math.max(a.seconds ?? 30, 5), 600) * 1000;
      if (g.paused) g.pausedLeft = Math.min(g.pausedLeft! + add, 30 * 60 * 1000);
      else g.deadline = Math.min(g.deadline! + add, Date.now() + 30 * 60 * 1000);
      break;
    }
    // Pause freezes the clock and refuses answers, for an interruption; resume carries on with the time that was left.
    case "pause":
      need(g.phase === "open", "only an open question can be paused");
      need(!g.paused, "already paused");
      g.pausedLeft = g.deadline ? Math.max(0, g.deadline - Date.now()) : null;
      g.deadline = null;
      g.paused = true;
      break;
    case "resume":
      need(g.phase === "open" && !!g.paused, "nothing is paused");
      g.deadline = g.pausedLeft != null ? Date.now() + g.pausedLeft : null;
      g.paused = false;
      g.pausedLeft = null;
      break;
    case "next":
      need(g.phase === "revealed", g.phase === "open" || g.phase === "closed" ? "reveal the answer first" : "session is not running");
      finishItem(g);
      if (g.cursor + 1 < items(g).length) {
        g.cursor++;
        g.phase = "open";
        openItem(g);
        // The theme is public from round two on, as in the first Tuesday trivia.
        if (items(g)[g.cursor]!.roundIdx >= 1) revealTheme(g);
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
      g.guessLog = (g.guessLog ?? []).filter((x) => x.playerId !== p.id);
      g.themeGuesses = g.themeGuesses.filter((x) => x.playerId !== p.id);
      delete g.scores[p.id];
      delete g.themeBonus[p.id];
      delete g.attempts[p.id];
      if (g.wagers) delete g.wagers[p.id];
      break;
    }
    case "review": {
      need(inPlay(g), "session is not running");
      const ans = g.answers.find((x) => x.id === a.answerId);
      if (!ans) throw new GameError("no such answer", 404);
      // Catches a slipped finger ("100" for "1"): twice what the question is worth, and never less than 10.
      const it = currentItem(g)!;
      const most = Math.max(10, 2 * getModule(it.type)!.points(it.config));
      if (Math.abs(a.points) > most) throw new GameError(`That is more than this question can award: the most is ${most}. Change the question's points in the builder if you want more.`, 409);
      ans.points = a.points;
      ans.status = a.points > 0 ? "approved" : "rejected";
      break;
    }
    case "theme_review": {
      need(!!g.theme && !g.themeRevealed, "no theme to review");
      const t = g.themeGuesses.find((x) => x.id === a.guessId);
      if (!t) throw new GameError("no such guess", 404);
      const mostBonus = Math.max(10, 2 * (g.theme?.bonus ?? 4));
      if (a.points > mostBonus) throw new GameError(`That is more than a theme bonus can be: the most is ${mostBonus}. Change the bonus in the builder if you want more.`, 409);
      t.points = a.points;
      t.status = a.points > 0 ? "approved" : "rejected";
      // Once every player has found it there is nothing left to hide.
      if (everyoneGotTheme(g)) revealTheme(g);
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

function itemMeta(g: Game, full: boolean, playerId?: string) {
  const it = currentItem(g);
  if (!it || !inPlay(g)) return null;
  const mod = getModule(it.type)!;
  const revealed = full || g.phase === "revealed";
  const shown = g.phase !== "open" || clueOpen(g); // players can see the question
  return {
    type: it.type,
    label: mod.label,
    round: it.roundTitle,
    section: it.section,
    pos: groupPos(g),
    input: mod.input,
    stakeKey: mod.stake?.(it.config, [])?.key ?? (mod.twoStep ? "wager" : undefined),
    // Two-step questions: "wager" until the host shows the question, then "clue".
    ...(mod.twoStep ? { stage: shown ? "clue" : "wager", wagerMax: playerId ? wagerMax(g, it, playerId) : mod.twoStep.max(it.config) } : {}),
    // The host always sees the whole question; everyone else sees it only once it has been shown.
    public: mod.publicView(it.config, full || shown),
    ...(revealed ? { solution: mod.solution(it.config), funFact: it.config.funFact } : {}),
    ...(full ? { config: it.config, points: mod.points(it.config), maxGuesses: it.maxGuesses ?? null } : {}),
  };
}

/** Leaderboards appear at the end of each round and at the end of the game, never after every question. */
const showBoard = (g: Game) => g.phase === "ended" || (g.phase === "revealed" && isRoundEnd(g));

const base = (g: Game) => ({
  code: g.code, title: g.title, phase: g.phase, number: g.cursor + 1, total: items(g).length,
  players: g.players.filter((p) => !p.kicked).length,
  // `now` is the server's clock, so a phone with a wrong clock still counts down correctly.
  timer: g.phase === "open" && (g.deadline || (g.paused && g.pausedLeft != null))
    ? { deadline: g.deadline ?? null, left: g.paused ? g.pausedLeft ?? undefined : undefined, paused: !!g.paused, now: Date.now() }
    : null,
  paused: g.phase === "open" && !!g.paused,
});

function guessesLeft(g: Game, playerId: string): number | null {
  const it = currentItem(g);
  const limit = it ? guessLimit(g, it) : 0;
  return it && limit > 0 ? Math.max(0, limit - (g.attempts[playerId] ?? 0)) : null;
}

const themePublic = (g: Game) =>
  g.theme ? { hint: g.theme.hint, revealed: g.themeRevealed, ...(g.themeRevealed ? { secret: g.theme.secret, formal: g.theme.formal } : {}) } : null;

export function playerView(g: Game, playerId: string, device?: string) {
  const board = showBoard(g) ? ranking(g, g.phase === "revealed") : null;
  const it = currentItem(g);
  const st = it && inPlay(g) ? stakeFor(g, it, playerId) : undefined;
  const mine = g.themeGuesses.filter((t) => t.playerId === playerId);
  return {
    ...base(g),
    item: itemMeta(g, false, playerId),
    stake: st ?? null,
    me: g.players.find((p) => p.id === playerId)?.nickname ?? "",
    // Only this player's own answers for the current item ever leave the server.
    // Whether an answer was right, and what it earned, stays hidden until the reveal (BUG-002 in docs/BUGS.md).
    myAnswers: g.answers
      .filter((a) => a.playerId === playerId)
      .map((a) => ({ value: a.value, ...(g.phase === "revealed" ? { status: a.status, points: a.points } : {}) })),
    guessesLeft: guessesLeft(g, playerId),
    myWager: g.wagers?.[playerId] ?? null,
    // Everything this team has tried on this question, oldest first. `you` is true for guesses sent from this phone.
    guessLog: (g.guessLog ?? [])
      .filter((e) => e.playerId === playerId)
      .map((e) => ({
        value: e.value, at: e.at, you: !!device && e.device === device,
        current: g.answers.some((a) => a.playerId === playerId && JSON.stringify(a.value) === JSON.stringify(e.value)),
      })),
    theme: g.theme && {
      ...themePublic(g),
      // Oldest first. The team shares one allowance, so every phone sees every guess; `you` marks the ones sent from this phone.
      myGuesses: mine.map((t) => ({ text: t.text, you: !!device && t.device === device })),
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
    wagered: g.players.filter((p) => !p.kicked && g.wagers?.[p.id] !== undefined).length,
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
    wagers: twoStepOf(it) ? g.players.filter((p) => !p.kicked).map((p) => ({ nickname: p.nickname, wager: g.wagers?.[p.id] ?? null })) : null,
    playerList: g.players.map((p) => ({ id: p.id, nickname: p.nickname, kicked: p.kicked, answered: answered.has(p.id), hasPin: !!p.pin })),
    answers: g.answers.map((a) => ({
      id: a.id, playerId: a.playerId, nickname: nick.get(a.playerId) ?? "?", value: a.value, status: a.status, points: a.points,
      // What each button awards. Stakes make "Right" and "Wrong" depend on the answer.
      full: mod!.fullPoints?.(it!.config, a.value) ?? mod!.points(it!.config),
      wrong: mod!.wrongPoints?.(it!.config, a.value) ?? 0,
      suggest: mod!.scoreAll ? null : mod!.score(it!.config, a.value),
    })),
    theme: g.theme && {
      secret: g.theme.secret, hint: g.theme.hint, formal: g.theme.formal, bonus: g.theme.bonus ?? 4, revealed: g.themeRevealed,
      guesses: g.themeGuesses.map((t) => ({
        id: t.id, nickname: nick.get(t.playerId) ?? "?", text: t.text, atNumber: t.atNumber, status: t.status, points: t.points,
        suggested: suggestedThemePoints(g.theme?.bonus),
      })),
      bonuses: g.themeRevealed ? Object.entries(g.themeBonus).map(([pid, points]) => ({ nickname: nick.get(pid) ?? "?", points })) : [],
    },
    leaderboard: ranking(g, g.phase === "revealed").map((r) => ({ id: r.id, nickname: r.nickname, points: r.points })),
  };
}
