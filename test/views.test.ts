import { test } from "node:test";
import assert from "node:assert/strict";
import { DECK_BOARD_ROWS, act, deckView, hostView, joinPlayer, newGame, outline, playerHistory, playerView, submit, submitTheme, themeWaitMs, type Game } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";
import { openDb } from "../src/db.js";
import { GameStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { buildApp } from "../src/app.js";
// @ts-expect-error plain browser module with no types
import { answerOrder, deckGrid } from "../public/js/layout.js";

// What a team sees of its own finished questions, what the host sees of the whole night, and the host and projector layouts.

const t = (answer: string, extra: string[] = [], section?: string) => ({ type: "text_qa", section, config: { question: "q " + answer, answers: [answer, ...extra], points: 4 } });
const conf = (answer: string) => ({ type: "confidence", config: { question: "c " + answer, answers: [answer], poolId: "p", poolValues: [8, 6, 4, 2] } });
const jeo = { type: "jeopardy", config: { category: "cat", question: "j", answers: ["jj"], maxWager: 20, capByScore: false, silentLoses: true } };
const theme = { secret: "fall", hint: "h", formal: "f", bonus: 4 };

function make(rounds: object[], withTheme = false) {
  const store = new GameStore(openDb(":memory:"));
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse(rounds), code: "ABCDE", maxGuesses: 3, timeLimit: 0, theme: withTheme ? theme : undefined });
  const ann = joinPlayer(g, "Ann", "1111").player, bob = joinPlayer(g, "Bob", "2222").player;
  act(g, { action: "begin" });
  store.save(g);
  const step = (...a: string[]) => { for (const x of a) act(g, { action: x } as any); store.save(g); };
  const hist = (id: string) => playerHistory(g, id, store.records(g.id));
  return { g, ann, bob, store, step, hist };
}
const boardOf = (g: Game, name: string) => hostView(g).leaderboard.find((l) => l.nickname === name)!.points;

test("My answers: what the team said, what it earned, and the real answer wherever it did not get it", () => {
  const { g, ann, bob, step, hist } = make([{ title: "R", modules: [t("alpha"), t("beta"), t("gamma"), t("delta")] }]);
  submit(g, ann.id, { text: "alpha" });   // right
  submit(g, bob.id, { text: "nope" });    // wrong
  step("close", "reveal", "next");
  submit(g, bob.id, { text: "beta" });    // Ann sends nothing
  step("close", "reveal", "next");
  submit(g, ann.id, { text: "gamma" });
  step("close");
  act(g, { action: "review", answerId: g.answers[0]!.id, points: 2 }); // the host gives half credit
  step("reveal", "next");

  const a = hist(ann.id), b = hist(bob.id);
  assert.deepEqual(a.rows.map((r) => [r.number, r.result, r.points, r.yourAnswer, r.solution]), [
    [1, "right", 4, "alpha", null],
    [2, "none", 0, null, "beta"],
    [3, "partial", 2, "gamma", "gamma"],
  ]);
  assert.deepEqual(b.rows.map((r) => [r.number, r.result, r.points, r.yourAnswer, r.solution]), [
    [1, "wrong", 0, "nope", "alpha"],
    [2, "right", 4, "beta", null],
    [3, "none", 0, null, "gamma"],
  ]);
  assert.equal(a.total, 6);
  assert.equal(b.total, 4);
  assert.ok(!JSON.stringify(a).includes("nope"), "never another team's answer");
  assert.ok(!JSON.stringify(a).includes("delta"), "never a question that has not been played");
});

test("My answers counts the question on screen only once it is revealed, and then agrees with the scoreboard", () => {
  const { g, ann, step, hist } = make([{ title: "R", modules: [t("alpha"), t("beta")] }]);
  submit(g, ann.id, { text: "alpha" });
  assert.equal(hist(ann.id).rows.length, 0, "an open question is not in the list");
  assert.ok(!JSON.stringify(hist(ann.id)).includes("beta"));
  step("close");
  assert.equal(hist(ann.id).rows.length, 0, "nor a closed one: its answer is not public yet");
  step("reveal");
  assert.equal(hist(ann.id).rows.length, 1);
  assert.equal(hist(ann.id).total, boardOf(g, "Ann"), "the same number as the scoreboard");
  step("next");
  assert.equal(hist(ann.id).rows.length, 1, "and not twice once the host moves on");
  assert.equal(hist(ann.id).total, boardOf(g, "Ann"));
});

test("My answers shows stakes, a lost Final Jeopardy wager, and the theme bonus once it is public", () => {
  const { g, ann, bob, step, hist } = make([{ title: "R1", modules: [conf("a")] }, { title: "R2", modules: [jeo] }], true);
  submit(g, ann.id, { text: "a", bet: 8 });
  submitTheme(g, ann.id, "fall");
  step("close", "reveal");
  assert.equal(hist(ann.id).themeBonus, 0, "the bonus is not shown while the theme is secret");
  step("next"); // round two: the theme goes public
  assert.equal(hist(ann.id).themeBonus, 4);
  assert.equal(hist(ann.id).total, boardOf(g, "Ann"), "stake points and the bonus agree with the scoreboard");
  assert.deepEqual(hist(ann.id).rows.map((r) => [r.yourAnswer, r.points]), [["a (stake 8)", 8]]);
  // Final Jeopardy: Bob wagers and says nothing, so the wager is lost.
  g.wagers = { [bob.id]: 5 };
  step("showclue", "close", "reveal");
  const row = hist(bob.id).rows.at(-1)!;
  assert.equal(row.result, "none");
  assert.equal(row.lostWager, 5);
  assert.equal(row.solution, "jj");
  assert.equal(hist(bob.id).total, boardOf(g, "Bob"));
});

test("a theme guess the host marked wrong is crossed off for the team, and nothing else is given away", () => {
  const { g, ann, bob, step } = make([{ title: "R", modules: [t("a"), t("b")] }], true);
  submitTheme(g, ann.id, "winter");
  submitTheme(g, ann.id, "fall");     // exactly right
  submitTheme(g, ann.id, "pumpkins"); // not marked yet
  submitTheme(g, bob.id, "summer");
  const guess = (text: string) => g.themeGuesses.find((x) => x.text === text)!;
  act(g, { action: "theme_review", guessId: guess("winter").id, points: 0 });
  act(g, { action: "theme_review", guessId: guess("summer").id, points: 0 });
  const mine = () => playerView(g, ann.id).theme!.myGuesses.map((x) => [x.text, x.struck]);
  assert.deepEqual(mine(), [["winter", true], ["fall", false], ["pumpkins", false]], "only the wrong one is crossed off; the right one reads like one not yet looked at");
  assert.equal(playerView(g, ann.id).theme!.guessesLeft, 40 - 3, "a crossed-off guess still counts toward the ceiling");
  assert.ok(!JSON.stringify(playerView(g, bob.id)).includes("winter"), "and a team never sees another team's guesses");
  assert.deepEqual(hostView(g).theme!.guesses.map((x) => [x.text, x.status]).filter((x) => x[0] === "winter" || x[0] === "fall"), [["winter", "rejected"], ["fall", "pending"]]);
  void step;
});

test("the host's whole-night list: every question and answer, with where the game is", () => {
  const { g, ann, step } = make([{ title: "R1", modules: [t("alpha", ["Alfa"], "Hodge"), t("beta")] }, { title: "R2", modules: [jeo] }]);
  let o = outline(g);
  assert.deepEqual(o.questions.map((q) => [q.number, q.status]), [[1, "current"], [2, "upcoming"], [3, "upcoming"]]);
  assert.equal(o.current, 1);
  assert.equal(o.total, 3);
  assert.deepEqual(o.questions[0]!.alsoAccepts, ["Alfa"]);
  assert.equal(o.questions[0]!.answer, "alpha");
  assert.equal(o.questions[0]!.section, "Hodge");
  assert.equal(o.questions[0]!.revealed, false);
  submit(g, ann.id, { text: "alpha" });
  step("close", "reveal");
  assert.equal(outline(g).questions[0]!.revealed, true);
  step("next");
  o = outline(g);
  assert.deepEqual(o.questions.map((q) => q.status), ["done", "current", "upcoming"]);
  step("close", "reveal", "next", "showclue", "close", "reveal", "next");
  assert.deepEqual(outline(g).questions.map((q) => q.status), ["done", "done", "done"], "all done once it has ended");
  assert.equal(outline(g).phase, "ended");
});

test("the projector lists more teams than a phone, and the host's answers say when each arrived", () => {
  const store = new GameStore(openDb(":memory:"));
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules: [t("a"), t("b")] }]), code: "ABCDE", maxGuesses: 3 });
  for (let i = 0; i < 40; i++) joinPlayer(g, `Team ${i}`);
  act(g, { action: "begin" });
  submit(g, g.players[3]!.id, { text: "a" });
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" });
  act(g, { action: "close" }); act(g, { action: "reveal" }); // the last question of the round: the scoreboard shows
  assert.equal(deckView(g).leaderboard!.length, 24, "the projector shows up to 24");
  assert.equal(DECK_BOARD_ROWS, 24);
  assert.equal(playerView(g, g.players[0]!.id).leaderboard!.length, 10, "a phone still shows the top 10");
  g.answers.push({ id: "x", playerId: g.players[0]!.id, value: { text: "z" }, status: "pending", points: 0, at: 123 });
  assert.equal(hostView(g).answers.at(-1)!.at, 123);
  void store;
});

test("answer order: waiting answers first, newest on top; marked ones settle below", () => {
  const rows = [
    { id: "a", status: "approved", at: 50 },
    { id: "b", status: "pending", at: 10 },
    { id: "c", status: "pending", at: 30 },
    { id: "d", status: "rejected", at: 40 },
    { id: "e", status: "pending", at: 20 },
  ];
  assert.deepEqual(answerOrder(rows).map((r: any) => r.id), ["c", "e", "b", "a", "d"]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", "d", "e"], "the original list is not reordered in place");
  assert.deepEqual(answerOrder([]), []);
  assert.deepEqual(answerOrder([{ status: "pending" }, { status: "pending", at: 5 }]).map((r: any) => r.at), [5, undefined]);
});

test("projector scoreboard layout: about twelve rows a column, up to four columns", () => {
  assert.deepEqual([0, 1, 12].map(deckGrid), [{ cols: 1, rows: 1 }, { cols: 1, rows: 1 }, { cols: 1, rows: 12 }]);
  assert.deepEqual(deckGrid(13), { cols: 2, rows: 7 });
  assert.deepEqual(deckGrid(24), { cols: 2, rows: 12 });
  assert.deepEqual(deckGrid(25), { cols: 3, rows: 9 });
  assert.deepEqual(deckGrid(100), { cols: 4, rows: 25 });
});

test("over HTTP: a team gets only its own history; only the owner gets the outline", async () => {
  const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
  const hosts = HostDirectory.fromLists({ admins: ["o@example.com"], hosts: ["other@example.com"] });
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const hdr = async (email: string) => ({ cookie: "trivia_session=" + (await signSession(cfg, { email, name: email })), origin: cfg.BASE_URL });
  const owner = await hdr("o@example.com"), other = await hdr("other@example.com");
  const trivia = { title: "t", settings: { maxGuesses: 3 }, rounds: [{ title: "R", modules: [{ type: "text_qa", config: { question: "first?", answers: ["one"] } }, { type: "text_qa", config: { question: "second?", answers: ["two"] } }] }] };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: owner, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: owner })).json();
  const act2 = (a: string) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: owner, payload: { action: a } });
  const join = async (nickname: string) => { const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname } }); return { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL }; };
  const ann = await join("Ann"), bob = await join("Bob");
  await act2("begin");
  await app.inject({ method: "POST", url: "/api/play/answer", headers: ann, payload: { value: { text: "one" } } });
  await app.inject({ method: "POST", url: "/api/play/answer", headers: bob, payload: { value: { text: "SECRETBOB" } } });
  for (const a of ["close", "reveal", "next"]) await act2(a);

  assert.equal((await app.inject({ url: "/api/play/history" })).statusCode, 401, "no cookie, no history");
  const h = (await app.inject({ url: "/api/play/history", headers: ann })).json();
  assert.equal(h.total, 1);
  assert.deepEqual(h.rows.map((r: any) => [r.number, r.yourAnswer, r.result]), [[1, "one", "right"]]);
  assert.ok(!JSON.stringify(h).includes("SECRETBOB") && !JSON.stringify(h).includes("two"), "nothing of another team or of an unplayed question");
  assert.equal((await app.inject({ url: "/api/play/history", headers: bob })).json().rows[0].solution, "one");

  const o = await app.inject({ url: `/api/sessions/${id}/outline`, headers: owner });
  assert.equal(o.statusCode, 200);
  assert.deepEqual(o.json().questions.map((q: any) => [q.answer, q.status]), [["one", "done"], ["two", "current"]]);
  assert.equal((await app.inject({ url: `/api/sessions/${id}/outline`, headers: other })).statusCode, 404, "another host cannot");
  assert.equal((await app.inject({ url: `/api/sessions/${id}/outline`, headers: ann })).statusCode, 401, "a player cannot");
});

test("the theme guess pace: three in any 30 seconds, shared by the team, counted from when each was sent", () => {
  const { g, ann, bob } = make([{ title: "R", modules: [t("a"), t("b")] }], true);
  const T0 = 5_000_000;
  const at = (n: number, who = ann.id, secs = 0) => g.themeGuesses.push({ id: String(Math.random()), playerId: who, text: "g" + n + who, atNumber: 1, at: T0 + secs * 1000, status: "pending", points: 0 });
  assert.equal(themeWaitMs(g, ann.id, T0), 0, "no guesses yet");
  at(1, ann.id, 0); at(2, ann.id, 5);
  assert.equal(themeWaitMs(g, ann.id, T0 + 6_000), 0, "two in the window: free");
  at(3, ann.id, 10);
  assert.equal(themeWaitMs(g, ann.id, T0 + 12_000), 18_000, "three in the window: wait until the oldest is 30 seconds old");
  assert.equal(themeWaitMs(g, ann.id, T0 + 30_000), 0, "exactly 30 seconds after the first, it is open again");
  assert.equal(themeWaitMs(g, bob.id, T0 + 12_000), 0, "another team is not held up");
  // A fourth recorded inside the window (an old save, or a race) never makes the wait negative or silly.
  at(4, ann.id, 11);
  assert.equal(themeWaitMs(g, ann.id, T0 + 12_000), 23_000, "the wait is until only two remain in the window");
  // Guesses saved before the pace existed carry no time and never hold anyone up.
  const old = make([{ title: "R", modules: [t("a")] }], true);
  for (let i = 0; i < 5; i++) old.g.themeGuesses.push({ id: "o" + i, playerId: old.ann.id, text: "old" + i, atNumber: 1, status: "pending", points: 0 });
  assert.equal(themeWaitMs(old.g, old.ann.id), 0);
  assert.equal(playerView(old.g, old.ann.id).theme!.waitMs, 0);
});
