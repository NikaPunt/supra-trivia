import { test } from "node:test";
import assert from "node:assert/strict";
import { act, hostView, joinPlayer, newGame, playerView, submit, type Game } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";
import { openDb } from "../src/db.js";
import { GameStore } from "../src/store.js";

const q = (extra: object = {}) => ({ type: "text_qa", ...extra, config: { question: "q", answers: ["a"] } });
const make = (timeLimit: number, modules: object[] = [q(), q()]) => {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules }]), code: "ABCDE", maxGuesses: 3, timeLimit });
  const a = joinPlayer(g, "Ann").player;
  act(g, { action: "begin" });
  return { g, a };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the host's order is a waterfall: close, then reveal, then next", () => {
  const { g } = make(0);
  assert.throws(() => act(g, { action: "reveal" }), /close the answers first/, "open: cannot reveal");
  assert.throws(() => act(g, { action: "next" }), /reveal the answer first/, "open: cannot move on");
  assert.throws(() => act(g, { action: "reopen" }), /only a closed question/);
  act(g, { action: "close" });
  assert.throws(() => act(g, { action: "next" }), /reveal the answer first/, "closed: still cannot move on");
  act(g, { action: "reopen" });
  assert.equal(g.phase, "open", "a closed question can be reopened");
  act(g, { action: "close" });
  act(g, { action: "reveal" });
  for (const a of ["close", "reopen", "reveal"] as const) assert.throws(() => act(g, { action: a }), undefined, `revealed: ${a} is not allowed`);
  act(g, { action: "next" });
  assert.equal(g.cursor, 1);
  assert.equal(g.phase, "open");
  act(g, { action: "end" });
  assert.equal(g.phase, "ended", "ending the session is always allowed");
});

test("each question gets its own countdown: session default, per-question override, and none", () => {
  const { g } = make(180, [q(), q({ timeLimit: 30 }), q({ timeLimit: 0 })]);
  const near = (d: number | null | undefined, secs: number) => d != null && Math.abs(d - Date.now() - secs * 1000) < 2000;
  assert.ok(near(g.deadline, 180), "first question uses the session default of 3 minutes");
  act(g, { action: "close" }); assert.equal(g.deadline, null, "closing stops the clock");
  act(g, { action: "reopen" }); assert.ok(near(g.deadline, 180), "reopening starts the clock again");
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" });
  assert.ok(near(g.deadline, 30), "the second question has its own 30 seconds");
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" });
  assert.equal(g.deadline, null, "0 means no timer on that question");
  assert.throws(() => act(g, { action: "extend" }), /no timer/);
  const { g: none } = make(0);
  assert.equal(none.deadline, null, "a session with no time limit never starts a clock");
});

test("extending adds time, answers are refused once time is clearly up, and views carry the server clock", () => {
  const { g, a } = make(60);
  const before = g.deadline!;
  act(g, { action: "extend" });
  assert.equal(g.deadline! - before, 30_000, "plus 30 seconds by default");
  act(g, { action: "extend", seconds: 120 });
  assert.equal(g.deadline! - before, 150_000);
  const view = playerView(g, a.id).timer!;
  assert.equal(view.deadline, g.deadline);
  assert.ok(Math.abs(view.now - Date.now()) < 1000, "the view includes the server's own clock");
  assert.ok(hostView(g).timer && deckSafe(g));
  g.deadline = Date.now() - 5000; // time ran out a while ago but the server has not closed it yet
  assert.throws(() => submit(g, a.id, { text: "a" }), /time is up/);
});
const deckSafe = (g: Game) => playerView(g, g.players[0]!.id).timer !== null;

test("the server closes the question by itself when time runs out, even if nobody is looking", async () => {
  const store = new GameStore(openDb(":memory:"));
  const { g, a } = make(1);
  store.save(g);
  let announced = 0;
  store.bus.on(g.id, () => announced++);
  await sleep(1400);
  assert.equal(store.get(g.id)!.phase, "closed", "closed on its own");
  assert.ok(announced >= 1, "and everyone was told");
  assert.throws(() => submit(g, a.id, { text: "a" }), /closed/);
});

test("extending re-arms the timer, and moving on cancels the old one", async () => {
  const store = new GameStore(openDb(":memory:"));
  const { g } = make(1);
  store.save(g);
  act(g, { action: "extend", seconds: 5 });
  store.save(g);
  await sleep(1400);
  assert.equal(g.phase, "open", "the original deadline passed but the question was extended");
  act(g, { action: "close" }); store.save(g);
  await sleep(100);
  assert.equal(g.phase, "closed");
});

test("a question that ran out of time while the server was down closes when it starts up", async () => {
  const db = openDb(":memory:");
  const first = new GameStore(db);
  const { g } = make(60);
  g.deadline = Date.now() - 10_000; // the deadline passed during the outage
  first.save(g);
  const afterRestart = new GameStore(db);
  await sleep(150);
  assert.equal(afterRestart.get(g.id)!.phase, "closed");
});

// ---- pause ----

test("pause freezes the clock and refuses answers; resume carries on with the time that was left", async () => {
  const { g, a } = make(60);
  const leftBefore = g.deadline! - Date.now();
  act(g, { action: "pause" });
  assert.equal(g.paused, true);
  assert.equal(g.deadline, null, "no deadline while paused, so nothing can close the question");
  assert.ok(Math.abs(g.pausedLeft! - leftBefore) < 500, "the time that was left is kept");

  const v = playerView(g, a.id);
  assert.equal(v.paused, true);
  assert.equal(v.timer!.paused, true);
  assert.ok(Math.abs(v.timer!.left! - leftBefore) < 500, "every screen is told how much time is frozen");
  assert.throws(() => submit(g, a.id, { text: "a" }), /paused/, "players cannot answer meanwhile");

  const kept = g.pausedLeft!;
  await sleep(250); // the interruption: this must not cost the players any time
  assert.equal(g.pausedLeft, kept, "the frozen time does not drain");
  act(g, { action: "extend" });
  assert.equal(g.pausedLeft! - kept, 30_000, "adding time works while paused");
  act(g, { action: "resume" });
  assert.equal(g.paused, false);
  assert.ok(Math.abs(g.deadline! - Date.now() - (kept + 30_000)) < 100, "the clock restarts from what was left, plus what was added");
  submit(g, a.id, { text: "a" }); // answering works again
});

test("pause only applies to an open question, once, and can be ended by closing", () => {
  const { g } = make(60);
  assert.throws(() => act(g, { action: "resume" }), /nothing is paused/);
  act(g, { action: "pause" });
  assert.throws(() => act(g, { action: "pause" }), /already paused/);
  act(g, { action: "close" });
  assert.equal(g.phase, "closed");
  assert.equal(g.paused, false, "closing ends the pause");
  assert.equal(g.pausedLeft, null);
  assert.throws(() => act(g, { action: "pause" }), /only an open question/);
  act(g, { action: "reveal" });
  assert.throws(() => act(g, { action: "pause" }), /only an open question/);
  act(g, { action: "next" });
  assert.equal(g.paused, false, "the next question never starts paused");
});

test("a question with no timer can still be paused: answers wait, nothing else changes", () => {
  const { g, a } = make(0);
  act(g, { action: "pause" });
  assert.equal(g.pausedLeft, null);
  assert.equal(playerView(g, a.id).timer, null, "no countdown to show");
  assert.equal(playerView(g, a.id).paused, true, "but everyone still sees it is paused");
  assert.throws(() => submit(g, a.id, { text: "a" }), /paused/);
  assert.throws(() => act(g, { action: "extend" }), /no timer/);
  act(g, { action: "resume" });
  assert.equal(g.deadline, null);
  submit(g, a.id, { text: "a" });
});

test("the server's automatic close waits while paused, then closes after the remaining time", async () => {
  const store = new GameStore(openDb(":memory:"));
  const { g } = make(1);
  store.save(g);
  await sleep(300);
  act(g, { action: "pause" }); store.save(g);
  await sleep(1300); // well past the original one second
  assert.equal(g.phase, "open", "still open: the pause held it");
  act(g, { action: "resume" }); store.save(g);
  await sleep(400);
  assert.equal(g.phase, "open", "about 700ms were left, so it is not closed yet");
  await sleep(600);
  assert.equal(g.phase, "closed", "and it closes once those 700ms have run");
});

test("a paused game stays paused across a server restart", () => {
  const db = openDb(":memory:");
  const first = new GameStore(db);
  const { g } = make(60);
  first.save(g);
  act(g, { action: "pause" }); first.save(g);
  const second = new GameStore(db);
  const loaded = second.get(g.id)!;
  assert.equal(loaded.paused, true);
  assert.equal(loaded.phase, "open");
  assert.ok(loaded.pausedLeft! > 50_000);
});
