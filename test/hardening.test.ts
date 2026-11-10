import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { scryptSync } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb, SCHEMA_VERSION } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { GameStore } from "../src/store.js";
import { Streams, MAX_STREAMS_PER_VIEWER } from "../src/streams.js";
import { GAME_VERSION, MAX_PIN_FAILS, MAX_PLAYERS, act, hostView, joinPlayer, newGame, playerView, reviveGame, setWager, submit, submitTheme, type Game } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";

// Abuse holes and rule gaps found in the November 2026 audit, and the promise that games and trivias saved by
// earlier versions keep loading and playing exactly as they were.

const env = { BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" };
const cfg = loadConfig(env);
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com", "b@example.com"] });
const origin = { origin: cfg.BASE_URL };
const session = async (email: string, epoch = 0) => ({ cookie: `trivia_session=${await signSession(cfg, { email, name: email }, epoch)}`, ...origin });

const text = (answer = "a", extra: object = {}) => ({ type: "text_qa", config: { question: "q", answers: [answer], ...extra } });
const fj = (extra: object = {}) => ({ type: "jeopardy", config: { category: "c", question: "q", answers: ["a"], maxWager: 20, ...extra } });
const game = (rounds: object[], theme?: object) =>
  newGame({ hostEmail: "a@example.com", triviaId: "t", title: "t", rounds: roundsSchema.parse(rounds), code: "AAAAA", maxGuesses: 3, theme: theme as any });
const says = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message), `expected an error matching ${re}`);

// ---- who is counted, and under what address ----

test("a visitor cannot pick the address they are counted under", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  let blocked = 0;
  for (let i = 0; i < 40; i++) {
    // The proxy (a private address) appends the real visitor; whatever the visitor put first is their own invention.
    const r = await app.inject({ method: "POST", url: "/api/join", headers: { ...origin, "x-forwarded-for": `10.9.${i}.1, 203.0.113.9` }, payload: { code: "ZZZZZ", nickname: "a" }, remoteAddress: "172.18.0.2" });
    if (r.statusCode === 429) blocked++;
  }
  assert.equal(blocked, 20, "the join limit holds whatever the forged part says");
  // A sender that is not a proxy is not believed at all.
  let direct = 0;
  for (let i = 0; i < 40; i++) {
    const r = await app.inject({ method: "POST", url: "/api/join", headers: { ...origin, "x-forwarded-for": `198.51.100.${i}` }, payload: { code: "ZZZZZ", nickname: "a" }, remoteAddress: "203.0.113.50" });
    if (r.statusCode === 429) direct++;
  }
  assert.equal(direct, 20);
  await app.close();
});

test("TRUST_PROXY: private ranges by default, a list or off on request, and no hop counts", () => {
  assert.equal(cfg.TRUST_PROXY, "loopback, linklocal, uniquelocal");
  assert.equal(loadConfig({ ...env, TRUST_PROXY: "172.18.0.0/16" }).TRUST_PROXY, "172.18.0.0/16");
  assert.equal(loadConfig({ ...env, TRUST_PROXY: "false" }).TRUST_PROXY, false);
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY: "1" }));
});

// ---- joining ----

test("wrong PINs lock a name for a while, never for good, and the host can let the team back in", () => {
  const g = game([{ title: "R", modules: [text()] }]);
  const team = joinPlayer(g, "Quizzers", "1234").player;
  for (let i = 0; i < MAX_PIN_FAILS; i++) says(() => joinPlayer(g, "quizzers", "0000"), /taken/);
  says(() => joinPlayer(g, "Quizzers", "1234"), /few minutes/);
  assert.equal(hostView(g).playerList[0]!.pinLocked, true, "the host can see the name is locked");
  act(g, { action: "letin", playerId: team.id });
  assert.equal(joinPlayer(g, "Quizzers", "1234").player.id, team.id, "let back in by the host");

  for (let i = 0; i < MAX_PIN_FAILS; i++) says(() => joinPlayer(g, "quizzers", "0000"), /taken/);
  team.pinLockedUntil = Date.now() - 1; // the lock has run out
  assert.equal(joinPlayer(g, "Quizzers", "1234").rejoined, true, "the lock ends by itself");
});

test("removed players free their seats, and a closed room takes nobody new but lets teams back in", () => {
  const g = game([{ title: "R", modules: [text()] }]);
  const keep = joinPlayer(g, "Keepers", "1234").player;
  for (let i = 0; i < MAX_PLAYERS - 1; i++) joinPlayer(g, `bot${i}`);
  says(() => joinPlayer(g, "late"), /full/);
  for (const p of g.players) if (p.id !== keep.id) act(g, { action: "kick", playerId: p.id });
  assert.equal(joinPlayer(g, "late").rejoined, false, "seats of removed players are free again");

  act(g, { action: "lock" });
  says(() => joinPlayer(g, "later still"), /closed/);
  assert.equal(joinPlayer(g, "Keepers", "1234").player.id, keep.id, "a team with its PIN still gets back in");
  act(g, { action: "unlock" });
  assert.equal(joinPlayer(g, "later still").rejoined, false);
});

test("a PIN set by an earlier version still opens the door", () => {
  const g = game([{ title: "R", modules: [text()] }]);
  const p = joinPlayer(g, "Old Timers").player;
  p.pin = { salt: "0011223344556677", hash: scryptSync("4321", "0011223344556677", 32).toString("hex") }; // as stored before the cost was recorded
  p.pinFails = 10; // and locked for good under the old rule
  assert.equal(joinPlayer(g, "old timers", "4321").player.id, p.id);
});

// ---- rules ----

test("Final Jeopardy: wagering and then staying silent loses the wager", () => {
  const g = game([{ title: "R", modules: [text(), fj()] }]);
  const [a, b, c] = ["A", "B", "C"].map((n) => joinPlayer(g, n).player) as [any, any, any];
  act(g, { action: "begin" });
  for (const p of [a, b, c]) submit(g, p.id, { text: "a" });
  for (const x of ["close", "reveal", "next"] as const) act(g, { action: x });
  setWager(g, a.id, 1); setWager(g, b.id, 1); setWager(g, c.id, 0);
  act(g, { action: "showclue" });
  submit(g, a.id, { text: "wrong" });
  assert.equal(hostView(g).forfeits.length, 0, "nothing is lost while answers are still open");
  act(g, { action: "close" });
  act(g, { action: "reveal" });
  assert.deepEqual(hostView(g).forfeits, [{ nickname: "B", lost: 1 }]);
  assert.equal(playerView(g, b.id).forfeit, 1);
  assert.equal(playerView(g, c.id).forfeit, null, "a wager of nothing loses nothing");
  act(g, { action: "next" });
  assert.deepEqual([g.scores[a.id], g.scores[b.id], g.scores[c.id]], [0, 0, 1]);
});

test("Final Jeopardy: the rule can be turned off, and a game started before the rule plays on without it", () => {
  for (const [label, strip] of [["unticked", false], ["saved before the rule", true]] as const) {
    const g = game([{ title: "R", modules: [fj({ silentLoses: false })] }]);
    if (strip) delete (g.rounds[0]!.modules[0]!.config as any).silentLoses;
    const p = joinPlayer(g, "P").player;
    act(g, { action: "begin" });
    setWager(g, p.id, 5);
    for (const x of ["showclue", "close", "reveal", "next"] as const) act(g, { action: x });
    assert.equal(g.scores[p.id] ?? 0, 0, label);
  }
  // Ending the session while the question is still open is not silence.
  const g = game([{ title: "R", modules: [fj()] }]);
  const p = joinPlayer(g, "P").player;
  act(g, { action: "begin" });
  setWager(g, p.id, 5);
  act(g, { action: "showclue" });
  act(g, { action: "end" });
  assert.equal(g.scores[p.id] ?? 0, 0);
});

test("a right theme guess is never lost because the host had not marked it", () => {
  const rounds = [{ title: "R1", modules: [text()] }, { title: "R2", modules: [text()] }];
  const theme = { secret: "Outer Space", hint: "", formal: "", bonus: 4 };
  const g = game(rounds, theme);
  const [a, b] = ["A", "B"].map((n) => joinPlayer(g, n).player) as [any, any];
  act(g, { action: "begin" });
  submitTheme(g, a.id, "  outer-space! ");
  submitTheme(g, b.id, "the cosmos");
  act(g, { action: "close" });
  act(g, { action: "reveal" });
  says(() => act(g, { action: "next" }), /1 theme guess is still waiting/);
  assert.equal(g.cursor, 0, "the refused step changed nothing");
  says(() => act(g, { action: "theme_reveal" }), /still waiting/);
  act(g, { action: "theme_review", guessId: hostView(g).theme!.guesses.find((t) => t.status === "pending")!.id, points: 0 });
  act(g, { action: "next" });
  assert.equal(g.themeRevealed, true);
  assert.equal(g.themeBonus[a.id], 4, "the word-for-word guess was approved by itself");
  assert.equal(g.themeBonus[b.id] ?? 0, 0);

  // Ending is the emergency exit: it is never refused, and still honours a word-for-word guess.
  const e = game(rounds, theme);
  const p = joinPlayer(e, "P").player, q = joinPlayer(e, "Q").player;
  act(e, { action: "begin" });
  submitTheme(e, p.id, "outer space");
  submitTheme(e, q.id, "something else");
  act(e, { action: "end" });
  assert.equal(e.themeBonus[p.id], 4);
});

test("closest number: marking the winner by hand does not also pay the runner-up", () => {
  const g = game([{ title: "R", modules: [{ type: "numeric_closest", config: { question: "q", value: 10 } }] }]);
  const [a, b] = ["A", "B"].map((n) => joinPlayer(g, n).player) as [any, any];
  act(g, { action: "begin" });
  submit(g, a.id, { value: 10 });
  submit(g, b.id, { value: 500 });
  act(g, { action: "review", answerId: g.answers.find((x) => x.playerId === a.id)!.id, points: 1 });
  act(g, { action: "close" });
  act(g, { action: "reveal" });
  assert.deepEqual(g.answers.map((x) => x.points), [1, 0]);

  // An answer the host threw out no longer stands in anyone's way.
  const h = game([{ title: "R", modules: [{ type: "numeric_closest", config: { question: "q", value: 10 } }] }]);
  const [c, d] = ["C", "D"].map((n) => joinPlayer(h, n).player) as [any, any];
  act(h, { action: "begin" });
  submit(h, c.id, { value: 10 });
  submit(h, d.id, { value: 12 });
  act(h, { action: "review", answerId: h.answers.find((x) => x.playerId === c.id)!.id, points: 0 });
  act(h, { action: "close" });
  act(h, { action: "reveal" });
  assert.deepEqual(h.answers.map((x) => x.points), [0, 1]);
});

// ---- the API ----

const trivia = { title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds: [{ title: "R", modules: [text()] }] };

test("saving over a version you have not seen is refused; saving as before still works", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const a = await session("a@example.com");
  const id = (await app.inject({ method: "POST", url: "/api/trivias", headers: a, payload: trivia })).json().id;
  const opened = (await app.inject({ url: `/api/trivias/${id}`, headers: a })).json().updated_at;
  await new Promise((r) => setTimeout(r, 5));
  const first = await app.inject({ method: "PUT", url: `/api/trivias/${id}`, headers: a, payload: { ...trivia, title: "from tab one", base: opened } });
  assert.equal(first.statusCode, 200);
  const stale = await app.inject({ method: "PUT", url: `/api/trivias/${id}`, headers: a, payload: { ...trivia, title: "from tab two", base: opened } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().conflict, true);
  assert.equal((await app.inject({ url: `/api/trivias/${id}`, headers: a })).json().title, "from tab one", "nothing was overwritten");
  const next = await app.inject({ method: "PUT", url: `/api/trivias/${id}`, headers: a, payload: { ...trivia, title: "tab one again", base: first.json().updated_at } });
  assert.equal(next.statusCode, 200, "the version handed back by a save is the one to build on");
  // A page loaded before this check existed sends no version and saves as it always did.
  assert.equal((await app.inject({ method: "PUT", url: `/api/trivias/${id}`, headers: a, payload: { ...trivia, title: "old page" } })).statusCode, 200);
  await app.close();
});

test("log out everywhere ends every session of that host and nobody else's; earlier logins stay valid until then", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const laptop = await session("a@example.com"), phone = await session("a@example.com"), other = await session("b@example.com");
  const me = async (h: object) => (await app.inject({ url: "/api/me", headers: h as any })).json().host;
  assert.ok(await me(laptop), "a login from before the counter existed still works");
  assert.equal((await app.inject({ method: "POST", url: "/auth/logout-all", headers: phone })).statusCode, 200);
  assert.equal(await me(laptop), null);
  assert.equal(await me(phone), null);
  assert.ok(await me(other));
  assert.ok(await me(await session("a@example.com", 1)), "signing in again works");
  await app.close();
});

test("the sample trivia and its answers are for signed-in hosts only", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  for (const url of ["/starter.json", "/starter%2Ejson", "/./starter.json", "//starter.json", "/STARTER.JSON", "/js/../starter.json"]) {
    const r = await app.inject(url);
    assert.ok(r.statusCode >= 400 && !r.body.includes('"answers"'), `${url} gave ${r.statusCode}`);
  }
  const r = await app.inject({ url: "/starter.json", headers: await session("a@example.com") });
  assert.equal(r.statusCode, 200);
  assert.ok(Array.isArray(r.json().rounds));
  await app.close();
});

test("health check asks the database", async () => {
  const db = openDb(":memory:");
  const app = await buildApp(cfg, db, hosts);
  assert.equal((await app.inject("/healthz")).statusCode, 200);
  db.close();
  assert.equal((await app.inject("/healthz")).statusCode, 503);
  await app.close();
});

test("live connections are capped per viewer, and a closed one gives its place back", () => {
  const s = new Streams();
  const fake = () => ({ end() {} }) as any;
  const forget: (() => void)[] = [];
  for (let i = 0; i < MAX_STREAMS_PER_VIEWER; i++) { assert.ok(s.hasRoom("g", "p:1")); forget.push(s.add("g", "p:1", fake())); }
  assert.equal(s.hasRoom("g", "p:1"), false);
  assert.equal(s.hasRoom("g", "p:2"), true, "another team is not affected");
  forget[0]!(); forget[0]!();
  assert.equal(s.hasRoom("g", "p:1"), true);
  assert.equal(s.open, MAX_STREAMS_PER_VIEWER - 1);
});

// ---- data saved by earlier versions ----

/** A game exactly as the first deployed version stored it: none of the later fields. */
const firstVersionGame = (over: object = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", code: "QQQQQ", hostEmail: "a@example.com", triviaId: "t", title: "old night",
  rounds: [{ title: "R1", modules: [{ type: "text_qa", config: { question: "q1", answers: ["a"], points: 1 } }, { type: "text_qa", config: { question: "q2", answers: ["b"], points: 1 } }] }],
  maxGuesses: 3, phase: "open", cursor: 0,
  players: [{ id: "22222222-2222-4222-8222-222222222222", nickname: "Old Team", joinedAt: 1, kicked: false, pinFails: 0 }],
  answers: [], attempts: {}, poolUsed: {}, scores: {}, theme: null, themeRevealed: false, themeGuesses: [], themeBonus: {}, history: [], createdAt: 1, endedAt: null,
  ...over,
});

test("a game stored by the first version loads and plays on to the end", () => {
  const db = openDb(":memory:");
  const old = firstVersionGame();
  db.prepare("INSERT INTO games (id, code, host_email, ended, state, updated_at) VALUES (?, ?, ?, 0, ?, 1)").run(old.id, old.code, old.hostEmail, JSON.stringify(old));
  const store = new GameStore(db);
  const g = store.getByCode("qqqqq")!;
  assert.ok(g, "still joinable by its code");
  assert.equal(g.v, GAME_VERSION);
  const pid = g.players[0]!.id;
  assert.equal(playerView(g, pid).item!.public.question, "q1");
  submit(g, pid, { text: "a" });
  for (const x of ["close", "reveal", "next"] as const) act(g, { action: x });
  submit(g, pid, { text: "b" });
  for (const x of ["close", "reveal", "next"] as const) act(g, { action: x });
  store.save(g);
  assert.equal(g.phase, "ended");
  assert.equal(g.scores[pid], 2);
  assert.equal(joinPlayer(reviveGame(firstVersionGame()), "New Team").rejoined, false);
  store.close();
});

test("a stored game that cannot be read is skipped and left alone; the rest load", () => {
  const db = openDb(":memory:");
  const good = firstVersionGame();
  const put = (id: string, state: string) => db.prepare("INSERT INTO games (id, code, host_email, ended, state, updated_at) VALUES (?, 'X', 'a@example.com', 0, ?, 1)").run(id, state);
  put(good.id, JSON.stringify(good));
  put("bad-json", "{not json");
  put("bad-type", JSON.stringify(firstVersionGame({ id: "bad-type", rounds: [{ title: "R", modules: [{ type: "retired_type", config: {} }] }] })));
  put("bad-cursor", JSON.stringify(firstVersionGame({ id: "bad-cursor", cursor: 9 })));
  const errors: string[] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void errors.push(a.join(" "));
  let store: GameStore;
  try { store = new GameStore(db); } finally { console.error = real; }
  assert.deepEqual(store.unreadable.sort(), ["bad-cursor", "bad-json", "bad-type"]);
  assert.equal(errors.length, 3, "each one is reported");
  assert.equal(store.list().length, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n, 4, "nothing was deleted");
  store.close();
});

test("finished games leave memory after a day but stay readable and listed; deleting them is opt-in", () => {
  const db = openDb(":memory:");
  const longAgo = Date.now() - 40 * 24 * 3600 * 1000;
  const ended = firstVersionGame({ phase: "ended", endedAt: longAgo, scores: { "22222222-2222-4222-8222-222222222222": 7 } });
  db.prepare("INSERT INTO games (id, code, host_email, ended, state, updated_at) VALUES (?, ?, ?, 1, ?, ?)").run(ended.id, ended.code, ended.hostEmail, JSON.stringify(ended), longAgo);
  const store = new GameStore(db);
  assert.equal((store as any).games.size, 0, "not held in memory");
  assert.deepEqual(store.list().map((g) => [g.title, g.phase, g.players]), [["old night", "ended", 1]]);
  assert.equal(hostView(store.get(ended.id)!).leaderboard[0]!.points, 7, "the final scores can still be opened");
  assert.equal(store.getByCode("QQQQQ"), undefined);
  store.close();

  const keeps = new GameStore(db, 0);
  assert.equal(keeps.list().length, 1, "kept for ever unless told otherwise");
  keeps.close();
  const prunes = new GameStore(db, 30);
  assert.equal(prunes.list().length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number }).n, 0);
  prunes.close();
});

test("a database from before schema versions is brought up to date in place, and a newer one is refused", async () => {
  const dir = await import("node:fs").then((fs) => fs.mkdtempSync((process.env.TMPDIR ?? "/tmp") + "/trivia-test-"));
  const path = `${dir}/old.db`;
  const raw = new Database(path);
  // The very first schema: no settings column, no drafts, no version.
  raw.exec(`CREATE TABLE trivias (id TEXT PRIMARY KEY, host_email TEXT NOT NULL, title TEXT NOT NULL, rounds TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE games (id TEXT PRIMARY KEY, code TEXT NOT NULL, host_email TEXT NOT NULL, ended INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO trivias VALUES ('33333333-3333-4333-8333-333333333333', 'a@example.com', 'kept', '[{"title":"R","modules":[{"type":"text_qa","config":{"question":"q","clue1":"first clue","answers":["a"]}}]}]', 1, 1);`);
  raw.close();
  const db = openDb(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  const app = await buildApp(cfg, db, hosts);
  const got = (await app.inject({ url: "/api/trivias/33333333-3333-4333-8333-333333333333", headers: await session("a@example.com") })).json();
  assert.equal(got.title, "kept");
  assert.match(got.rounds[0].modules[0].config.question, /first clue/, "old question shapes are still folded into the new one");
  assert.equal((await app.inject({ method: "POST", url: "/api/trivias/33333333-3333-4333-8333-333333333333/sessions", headers: await session("a@example.com") })).statusCode, 201, "and it can be hosted");
  await app.close();
  db.close();
  assert.equal(openDb(path).pragma("user_version", { simple: true }), SCHEMA_VERSION, "opening again changes nothing");

  const newer = new Database(`${dir}/newer.db`);
  newer.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
  newer.close();
  assert.throws(() => openDb(`${dir}/newer.db`), /newer version/);
});
