import { test } from "node:test";
import assert from "node:assert/strict";
import { act, canUndoNext, hostView, joinPlayer, newGame, playerView, reviveGame, setWager, submit, submitTheme, type Game } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";
import { openDb } from "../src/db.js";
import { GameStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { buildApp } from "../src/app.js";

// Taking back a "Next question" pressed by mistake. It must put everything back exactly, and only while that is safe.

const t = (answer: string, extra: object = {}) => ({ type: "text_qa", config: { question: "q " + answer, answers: [answer], points: 4 }, ...extra });
const conf = (answer: string) => ({ type: "confidence", config: { question: "c " + answer, answers: [answer], poolId: "p", poolValues: [8, 6, 4, 2] } });
const jeo = { type: "jeopardy", config: { category: "cat", question: "j", answers: ["jj"], maxWager: 20, capByScore: false, silentLoses: true } };

function make(rounds: object[], theme?: { secret: string; hint: string; formal: string; bonus: number }) {
  const db = openDb(":memory:");
  const store = new GameStore(db);
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse(rounds), code: "ABCDE", maxGuesses: 3, timeLimit: 0, theme });
  const ann = joinPlayer(g, "Ann", "1111").player, bob = joinPlayer(g, "Bob", "2222").player;
  act(g, { action: "begin" });
  store.save(g);
  const step = (...a: Parameters<typeof act>[1]["action"][]) => { for (const x of a) act(g, { action: x } as any); store.save(g); };
  return { g, ann, bob, db, store, step };
}
const scores = (g: Game) => hostView(g).leaderboard.map((l) => `${l.nickname}:${l.points}`).join(" ");

test("undo puts the previous question back exactly: answers, marks open to change, and the score is not banked twice", () => {
  const { g, ann, bob, store, step } = make([{ title: "R", modules: [t("a"), t("b"), t("c")] }]);
  submit(g, ann.id, { text: "a" });
  submit(g, bob.id, { text: "wrong" });
  step("close", "reveal");
  assert.equal(scores(g), "Ann:4 Bob:0");
  step("next");
  assert.equal(g.cursor, 1);
  assert.equal(hostView(g).canUndo, true);
  assert.equal(scores(g), "Ann:4 Bob:0");

  step("undo_next");
  assert.equal(g.cursor, 0);
  assert.equal(g.phase, "revealed");
  assert.equal(g.history.length, 0, "the question is not in the history until the host moves on again");
  assert.equal(g.deadline, null);
  assert.equal(hostView(g).answers.length, 2, "the answers are back");
  assert.equal(scores(g), "Ann:4 Bob:0", "shown scores are the same, not doubled");
  assert.equal(g.scores[ann.id] ?? 0, 0, "and nothing was banked while it is being looked at");
  assert.equal(hostView(g).canUndo, false, "it can only be undone once");
  assert.throws(() => act(g, { action: "undo_next" }), /nothing to undo/);

  // The mistake is now fixable: mark Bob right, then move on once.
  act(g, { action: "review", answerId: g.answers.find((x) => x.playerId === bob.id)!.id, points: 4 });
  assert.equal(scores(g), "Ann:4 Bob:4");
  step("next");
  assert.equal(g.scores[ann.id], 4);
  assert.equal(g.scores[bob.id], 4);
  assert.equal(g.history.length, 1);
  assert.equal(g.cursor, 1);
  // A phone sees the right thing at each point.
  assert.equal(playerView(g, ann.id).number, 2);
  assert.equal(store.records(g.id).filter((r) => r.kind === "question").length, 1, "the question is filed once, with the corrected marks");
  const rec = store.records(g.id)[0]!.data as any;
  assert.deepEqual(rec.answers.map((a: any) => [a.team, a.points]).sort(), [["Ann", 4], ["Bob", 4]]);
});

test("undo is refused once the new question has an answer, a guess or a wager, and after the game ends", () => {
  const { g, ann, step } = make([{ title: "R", modules: [t("a"), t("b"), jeo] }]);
  step("close", "reveal", "next");
  assert.equal(canUndoNext(g), true);
  submit(g, ann.id, { text: "something" });
  assert.equal(canUndoNext(g), false);
  assert.throws(() => act(g, { action: "undo_next" }), /already has answers/);
  assert.equal(g.cursor, 1, "nothing moved");
  step("close", "reveal", "next"); // now on the Final Jeopardy question
  assert.equal(g.cursor, 2);
  assert.equal(canUndoNext(g), true, "a wager step nobody has touched can be taken back");
  setWager(g, ann.id, 5);
  assert.equal(canUndoNext(g), false, "a wager is something players did");
  assert.throws(() => act(g, { action: "undo_next" }));
  // Even if it is wiped, once the question has been shown to players it stays.
  g.wagers = {};
  act(g, { action: "showclue" });
  assert.equal(canUndoNext(g), false);
  step("close", "reveal", "next");
  assert.equal(g.phase, "ended");
  assert.throws(() => act(g, { action: "undo_next" }), /nothing to undo/, "the finished game cannot be reopened");
});

test("undo is refused in the lobby, before anything was moved on from", () => {
  const { g, step } = make([{ title: "R", modules: [t("a"), t("b")] }]);
  assert.throws(() => act(g, { action: "undo_next" }), /nothing to undo/);
  step("close", "reveal", "next");
  step("undo_next");
  assert.throws(() => act(g, { action: "undo_next" }), /nothing to undo/);
});

test("undo gives back confidence values and Final Jeopardy wagers exactly as they were", () => {
  const { g, ann, step } = make([{ title: "R", modules: [conf("a"), conf("b"), jeo] }]);
  submit(g, ann.id, { text: "a", bet: 8 });
  step("close", "reveal", "next");
  assert.deepEqual(g.poolUsed["set-0-0"]![ann.id], [8], "8 is spent once moving on");
  assert.deepEqual(playerView(g, ann.id).stake?.options, [6, 4, 2]);
  step("undo_next");
  assert.deepEqual(g.poolUsed["set-0-0"]?.[ann.id] ?? [], [], "taking it back un-spends it");
  // Changing the bet before moving on again is allowed, because the answer is open to marking only, not to resubmitting.
  assert.equal(g.answers[0]!.value && (g.answers[0]!.value as any).bet, 8);
  step("next");
  assert.deepEqual(g.poolUsed["set-0-0"]![ann.id], [8], "and moving on spends it exactly once, not twice");
  assert.equal(g.scores[ann.id], 8);
  step("undo_next");
  step("next");
  step("undo_next");
  step("next");
  assert.deepEqual(g.poolUsed["set-0-0"]![ann.id], [8], "any number of undo and redo cycles still spend it once");
  assert.equal(g.scores[ann.id], 8);
  assert.equal(g.history.length, 1);
});

test("undo across the theme going public puts the theme, guesses and bonuses back, and files its record only once", () => {
  const { g, ann, bob, store, step } = make([{ title: "R1", modules: [t("a")] }, { title: "R2", modules: [t("b")] }], { secret: "fall", hint: "h", formal: "f", bonus: 4 });
  submitTheme(g, ann.id, "fall");
  submitTheme(g, bob.id, "winter");
  step("close", "reveal");
  act(g, { action: "theme_review", guessId: g.themeGuesses.find((x) => x.playerId === bob.id)!.id, points: 0 });
  step("next");
  assert.equal(g.themeRevealed, true, "round two makes the theme public");
  assert.equal(g.themeBonus[ann.id], 4);
  assert.equal(g.themeGuesses.length, 0);
  assert.equal(store.records(g.id).filter((r) => r.kind === "theme").length, 1);

  step("undo_next");
  assert.equal(g.themeRevealed, false, "secret again");
  assert.equal(g.themeBonus[ann.id], undefined);
  assert.deepEqual(g.themeGuesses.map((x) => [x.text, x.status]).sort(), [["fall", "approved"], ["winter", "rejected"]], "the guesses and their marks are back");
  assert.equal(playerView(g, ann.id).theme?.revealed, false);
  assert.equal(store.records(g.id).filter((r) => r.kind === "theme").length, 0, "the theme record was withdrawn");
  assert.equal(store.records(g.id).filter((r) => r.kind === "question").length, 0);

  step("next");
  assert.equal(g.themeRevealed, true);
  assert.equal(g.themeBonus[ann.id], 4);
  assert.equal(store.records(g.id).filter((r) => r.kind === "theme").length, 1, "filed once again");
  assert.equal(store.records(g.id).filter((r) => r.kind === "question").length, 1);
});

test("a team removed in between does not come back, and a guess made on a theme still waiting is kept", () => {
  const { g, ann, bob, step } = make([{ title: "R", modules: [t("a"), t("b")] }], { secret: "fall", hint: "h", formal: "f", bonus: 4 });
  submit(g, ann.id, { text: "a" });
  submit(g, bob.id, { text: "a" });
  step("close", "reveal", "next");
  submitTheme(g, ann.id, "later guess"); // made on the new question, while the theme is still secret
  act(g, { action: "kick", playerId: bob.id });
  step("undo_next");
  assert.deepEqual(g.answers.map((x) => x.playerId), [ann.id], "the removed team's answer stays gone");
  assert.equal(scores(g), "Ann:4");
  assert.equal(g.themeGuesses.length, 1, "a theme guess made after moving on is not lost");
  assert.ok(!JSON.stringify(g.scores).includes(bob.id));
});

test("the undo point survives a restart, and a damaged one is dropped rather than breaking the game", () => {
  const { g, ann, step } = make([{ title: "R", modules: [t("a"), t("b")] }]);
  submit(g, ann.id, { text: "a" });
  step("close", "reveal", "next");
  const back = reviveGame(JSON.parse(JSON.stringify(g)));
  assert.equal(canUndoNext(back), true);
  act(back, { action: "undo_next" });
  assert.equal(back.phase, "revealed");
  assert.equal(scores(back), "Ann:4 Bob:0");
  const raw = JSON.parse(JSON.stringify(g));
  raw.undo = "garbage";
  const dropped = reviveGame(raw);
  assert.equal(dropped.undo, undefined);
  assert.equal(canUndoNext(dropped), false);
});

test("a question's timer starts afresh after undo and redo, and a pause does not leak through", () => {
  const db = openDb(":memory:");
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules: [t("a"), t("b")] }]), code: "ABCDE", maxGuesses: 3, timeLimit: 60 });
  joinPlayer(g, "Ann");
  act(g, { action: "begin" });
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" });
  assert.ok(g.deadline);
  act(g, { action: "pause" });
  act(g, { action: "undo_next" });
  assert.equal(g.deadline, null);
  assert.equal(g.paused, false);
  assert.equal(g.pausedLeft, null);
  act(g, { action: "next" });
  assert.ok(g.deadline && g.deadline > Date.now() + 55_000, "full time on the redone question");
  void db;
});

test("over HTTP: only the owner can undo, it is logged, and the console is told when it is possible", async () => {
  const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
  const hosts = HostDirectory.fromLists({ admins: ["o@example.com"], hosts: ["other@example.com"] });
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const hdr = async (email: string) => ({ cookie: "trivia_session=" + (await signSession(cfg, { email, name: email })), origin: cfg.BASE_URL });
  const owner = await hdr("o@example.com"), other = await hdr("other@example.com");
  const trivia = { title: "t", settings: { maxGuesses: 3 }, rounds: [{ title: "R", modules: [{ type: "text_qa", config: { question: "a?", answers: ["a"] } }, { type: "text_qa", config: { question: "b?", answers: ["b"] } }] }] };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: owner, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: owner })).json();
  const act2 = (h: object, a: string) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: h as any, payload: { action: a } });
  const view = async () => (await app.inject({ url: `/api/sessions/${id}`, headers: owner })).json();
  const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "Ann" } });
  const phone = { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL };
  for (const a of ["begin", "close", "reveal"]) await act2(owner, a);
  assert.equal((await view()).canUndo, false, "nothing to undo before moving on");
  assert.equal((await act2(owner, "undo_next")).statusCode, 409);
  await act2(owner, "next");
  assert.equal((await view()).canUndo, true);
  assert.equal((await act2(other, "undo_next")).statusCode, 404, "another host cannot");
  assert.equal((await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: phone, payload: { action: "undo_next" } })).statusCode, 401, "a player cannot");
  assert.equal((await act2(owner, "undo_next")).statusCode, 200);
  const v = await view();
  assert.equal(v.phase, "revealed");
  assert.equal(v.number, 1);
  assert.equal((await app.inject({ url: "/api/play/state", headers: phone })).json().number, 1, "the phones go back too");
  const audit = (await app.inject({ url: "/api/admin/audit", headers: owner })).json();
  assert.ok(JSON.stringify(audit).includes("session.undo_next"), "taking a step back is on record");
});
