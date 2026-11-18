import { test } from "node:test";
import assert from "node:assert/strict";
import { act, hostView, newGame, BOT_RIGHT, BOT_WRONG, type Game } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";
// @ts-expect-error plain browser module with no types
import { alsoAccept, maxPoints, readiness, roundSummary } from "../public/js/ready.js";

// ---- the "Ready to host?" tab and the "Also accept" suggestions ----

test("also accept: offers the spellings the forgiving match would still miss, and nothing it already forgives", () => {
  assert.deepEqual(alsoAccept(["The Beatles"]), ["Beatles"]);
  assert.deepEqual(alsoAccept(["The Beatles", "beatles"]), [], "already there, whatever the capitals");
  assert.deepEqual(alsoAccept(["Simon & Garfunkel"]), ["Simon and Garfunkel"]);
  assert.deepEqual(alsoAccept(["St. Louis"]), ["Saint Louis"]);
  assert.deepEqual(alsoAccept(["Mt Everest"]), ["Mount Everest"]);
  assert.deepEqual(alsoAccept(["7"]), ["seven"]);
  assert.deepEqual(alsoAccept(["Twelve"]), ["12"]);
  assert.deepEqual(alsoAccept(["Beyoncé", "AC/DC", "Jay-Z", "1997"]), [], "accents, punctuation, hyphens and big numbers are already fine");
  assert.deepEqual(alsoAccept(["", "  "]), []);
});

test("max points: a threesome is 5 by default; wagers and confidence depend on the game", () => {
  assert.equal(maxPoints({ type: "nsome", config: {} }), 5);
  assert.equal(maxPoints({ type: "nsome", config: { count: "4", points: "1", bonus: "2" } }), 6);
  assert.equal(maxPoints({ type: "text_qa", config: { points: 2.5 } }), 2.5);
  assert.equal(maxPoints({ type: "text_qa", config: {} }), 1);
  assert.equal(maxPoints({ type: "wager", config: { maxWager: 15 } }), 15);
  assert.equal(maxPoints({ type: "jeopardy", config: { capByScore: true } }), null);
});

test("round summary: confidence sets count their best values once, and time includes marking and the scoreboard", () => {
  const conf = (section = "C") => ({ type: "confidence", section, config: { question: "q", answers: ["a"], poolValues: [8, 6, 4, 2] } });
  const r = { title: "R", modules: [conf(), conf(), conf(), { type: "text_qa", config: { question: "q", answers: ["a"], points: 1 } }] };
  const s = roundSummary(r, { timeLimit: 60 });
  assert.equal(s.points, 8 + 6 + 4 + 1);
  assert.equal(s.minutes, 4 * 2 + 2, "a minute to answer and a minute to mark each, plus two for the scoreboard");
  assert.equal(roundSummary({ title: "E", modules: [] }, {}).minutes, 0);
});

test("readiness: says how the night will go and points at what to fix", () => {
  const one = readiness({ settings: { maxGuesses: 3, timeLimit: 180, theme: { secret: "Cats", hint: "", formal: "", bonus: 4 } },
    rounds: [{ title: "Only", modules: [
      { type: "text_qa", config: { question: "Who sang Hey Jude?", answers: ["The Beatles"] } },
      { type: "nsome", config: { question: "Name three", answers: ["a", "b"], count: 3, catchall: true } },
      { type: "text_qa", config: {} },
      { type: "jeopardy", config: { question: "q", answers: ["a"] } },
    ] }] });
  const all = one.warnings.map((w: { text: string }) => w.text).join("\n");
  assert.match(one.rules.join("\n"), /only one round, so teams see no scoreboard until the very end/);
  assert.match(one.rules.join("\n"), /goes public at the end of the game/);
  assert.match(one.rules.join("\n"), /extra box on an N-some never scores by itself/);
  assert.match(one.rules.join("\n"), /wagers and then sends no answer loses/);
  assert.match(all, /no match/, "The Beatles without Beatles");
  assert.match(all, /accepts only 2/);
  assert.match(all, /question 3 is empty/);
  assert.match(all, /no category/);
  assert.match(all, /no hint/);
  assert.deepEqual(one.warnings.find((w: { text: string }) => /empty/.test(w.text)).at, { r: 0, i: 2 }, "a warning knows which question it is about");
  assert.match(one.facts.join("\n"), /3 guesses per question, which means its first answer plus 2 changes/);

  const two = readiness({ settings: { maxGuesses: 0, timeLimit: 0, theme: { secret: "Cats", hint: "h", formal: "f", bonus: 4 } },
    rounds: [{ title: "A", modules: [{ type: "text_qa", config: { question: "q", answers: ["x"] } }] }, { title: "Second", modules: [] }] });
  assert.match(two.rules.join("\n"), /round 2 \("Second"\) starts/);
  assert.match(two.facts.join("\n"), /no timer/);
  assert.match(two.facts.join("\n"), /as often as they like/);
  assert.match(two.facts.join("\n"), /at most 5 points \(4 of them for the secret theme\)/);
  assert.match(two.warnings.map((w: { text: string }) => w.text).join("\n"), /Round 2 \("Second"\) has no questions/);
});

// ---- practice runs ----

const practiceGame = (modules: unknown[]) => {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules }]), code: "ABCDE", maxGuesses: 3, practice: true });
  act(g, { action: "begin" });
  return g;
};
const board = (g: Game) => Object.fromEntries(hostView(g).leaderboard.map((r) => [r.nickname, r.points]));
const step = (g: Game) => { act(g, { action: "close" }); act(g, { action: "reveal" }); };

test("practice run: two bots join, answer at close (right and wrong), and every question type works", () => {
  const g = practiceGame([
    { type: "text_qa", config: { question: "q", answers: ["Nepal"], points: 2 } },
    { type: "multiple_choice", config: { question: "q", options: ["a", "b", "c"], correct: 2 } },
    { type: "numeric_closest", config: { question: "q", value: 1997 } },
    { type: "confidence", section: "C", config: { question: "q", answers: ["x"], poolValues: [8, 6] } },
    { type: "confidence", section: "C", config: { question: "q", answers: ["y"], poolValues: [8, 6] } },
    { type: "nsome", config: { question: "q", answers: ["a", "b", "c", "d"] } },
    { type: "wager", config: { question: "q", answers: ["w"], maxWager: 10 } },
  ]);
  assert.equal(g.title, "Practice: T");
  assert.deepEqual(g.players.map((p) => p.nickname), [BOT_RIGHT, BOT_WRONG]);
  assert.equal(hostView(g).practice, true);
  assert.equal(g.answers.length, 0, "nobody answers while the question is open, so Go back still works");
  for (let k = 0; k < 7; k++) {
    step(g);
    assert.equal(g.answers.length, 2, `question ${k + 1}: both bots answered`);
    if (k < 6) act(g, { action: "next" });
  }
  act(g, { action: "end" });
  const b = board(g);
  assert.equal(b[BOT_RIGHT], 2 + 1 + 1 + 8 + 6 + 5 + 5);
  assert.equal(b[BOT_WRONG], 1 - 5, "one right item on the N-some, wrong everywhere else, and it loses its wager");
});

test("practice run: Final Jeopardy bots wager before the question shows; a normal game has no bots", () => {
  const g = practiceGame([{ type: "jeopardy", config: { category: "c", question: "q", answers: ["a"], maxWager: 20 } }]);
  act(g, { action: "showclue" });
  assert.deepEqual(Object.values(g.wagers ?? {}), [5, 5]);
  step(g);
  act(g, { action: "end" });
  assert.deepEqual(board(g), { [BOT_RIGHT]: 5, [BOT_WRONG]: -5 });
  const real = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules: [{ type: "text_qa", config: { question: "q", answers: ["a"] } }] }]), code: "ABCDE", maxGuesses: 3 });
  assert.equal(real.players.length, 0);
  assert.equal(real.practice, undefined);
});

// ---- the routes ----

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const hosts = HostDirectory.fromLists({ admins: ["o@example.com"] });

test("routes: a practice session is started from the trivia, and Try an answer uses the server's matching", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const host = { cookie: "trivia_session=" + (await signSession(cfg, { email: "o@example.com", name: "O" })), origin: cfg.BASE_URL };
  const trivia = { title: "t", settings: { maxGuesses: 3 }, rounds: [{ title: "R", modules: [{ type: "text_qa", config: { question: "Q?", answers: ["a"] } }] }] };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia })).json();
  const p = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: host, payload: { practice: true } })).json();
  const view = (await app.inject({ url: `/api/sessions/${p.id}`, headers: host })).json();
  assert.equal(view.practice, true);
  assert.equal(view.playerList.length, 2);
  const real = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: host })).json();
  assert.equal((await app.inject({ url: `/api/sessions/${real.id}`, headers: host })).json().practice, false);

  const t = async (body: object) => (await app.inject({ method: "POST", url: "/api/modules/try", headers: host, payload: body })).json();
  assert.deepEqual(await t({ type: "text_qa", config: { question: "q", answers: ["The Beatles"], points: 2 }, value: { text: "the beatles!" } }), { points: 2, max: 2, stake: false });
  assert.equal((await t({ type: "text_qa", config: { question: "q", answers: ["The Beatles"] }, value: { text: "Beatles" } })).points, 0);
  assert.deepEqual(await t({ type: "nsome", config: { question: "q", answers: ["a", "b", "c"] }, value: { items: ["a", "b"] } }), { points: 2, max: 5, stake: false });
  assert.equal((await t({ type: "confidence", config: { question: "q", answers: ["x"], poolValues: [8, 6] }, value: { text: "x", bet: 1 } })).stake, true);
  assert.match((await t({ type: "text_qa", config: { question: "" }, value: { text: "a" } })).error, /Fill in/);
  assert.match((await t({ type: "nope", config: {}, value: {} })).error, /Unknown/);
  assert.match((await t({ type: "nsome", config: { question: "q", answers: ["a"] }, value: { items: ["a", "b", "c", "d"] } })).error, /at most 3/);
  assert.equal((await app.inject({ method: "POST", url: "/api/modules/try", headers: { origin: cfg.BASE_URL }, payload: {} })).statusCode, 401, "hosts only");
});
