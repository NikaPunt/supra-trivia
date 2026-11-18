import { test } from "node:test";
import assert from "node:assert/strict";
import { getModule, roundsSchema } from "../src/modules/index.js";

const m = getModule("nsome")!;
const cfg = (extra: object = {}) => m.configSchema.parse({ question: "q", answers: ["Paul", "John", "George", "Ringo"], ...extra });

test("nsome: 1 point each, +2 for all three, 5 at most", () => {
  const c = cfg();
  assert.equal(m.score(c, { items: ["paul", "JOHN!", "george"] }), 5);
  assert.equal(m.score(c, { items: ["paul", "john", "elvis"] }), 2);
  assert.equal(m.score(c, { items: ["elvis"] }), 0);
  assert.equal(m.points(c), 5);
});

test("nsome: repeats and order make no difference, extra items never score", () => {
  const c = cfg();
  assert.equal(m.score(c, { items: ["paul", "Paul", "PAUL"] }), 1);
  assert.equal(m.score(c, { items: ["john", "paul", "ringo"] }), 5);
  assert.equal(m.score(c, { items: ["elvis", "bob"], extra: "paul" }), 0);
});

test("nsome: the host sets points, bonus and how many", () => {
  const c = cfg({ count: 2, points: 1.5, bonus: 0.5 });
  assert.equal(m.score(c, { items: ["paul", "john"] }), 3.5);
  assert.equal(m.points(c), 3.5);
  assert.equal(m.score(cfg({ bonus: 0 }), { items: ["paul", "john", "george"] }), 3);
});

test("nsome: only the first N items count and too many are refused", () => {
  const c = cfg();
  assert.equal(m.score(c, { items: ["x", "y", "z", "paul"] }), 0);
  assert.match(m.check!(c, { items: ["a", "b", "c", "d"] })!, /at most 3/);
  assert.equal(m.check!(c, { items: ["a", "b", "c"] }), undefined);
});

test("nsome: the catch-all box is off unless the host turns it on", () => {
  assert.equal(cfg().catchall, false);
  assert.equal(m.publicView(cfg()).catchall, false);
  assert.ok(m.check!(cfg(), { items: ["a"], extra: "b" }));
  assert.equal(m.check!(cfg({ catchall: true }), { items: ["a"], extra: "b" }), undefined);
  assert.equal(m.publicView(cfg({ catchall: true })).catchall, true);
});

test("nsome: the public view never holds the answers; limits hold", () => {
  assert.equal(JSON.stringify(m.publicView(cfg({ funFact: "f" }))).includes("Paul"), false);
  assert.equal(m.configSchema.safeParse({ question: "q", answers: ["a"], count: 11 }).success, false);
  assert.equal(m.configSchema.safeParse({ question: "q", answers: ["a"], count: 1 }).success, false);
  assert.equal(m.answerSchema.safeParse({ items: ["!!!"] }).success, false);
  assert.equal(m.answerSchema.safeParse({ items: Array(11).fill("a") }).success, false);
  assert.equal(roundsSchema.safeParse([{ title: "r", modules: [{ type: "nsome", config: { question: "q", answers: ["a"] } }] }]).success, true);
});

import { act, hostView, joinPlayer, newGame, playerView, submit, type Game } from "../src/game.js";

function play(config: object) {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules: [{ type: "nsome", config: { question: "q", answers: ["a", "b", "c", "d"], ...config } }] }]), code: "ABCDE", maxGuesses: 3 });
  const ann = joinPlayer(g, "Ann").player;
  const bob = joinPlayer(g, "Bob").player;
  act(g, { action: "begin" });
  return { g, ann, bob };
}
const finish = (g: Game) => { act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "end" }); };

test("nsome in a game: scored at close, shown to the host, and the phone is told how many boxes", () => {
  const { g, ann, bob } = play({ catchall: true });
  const v = playerView(g, ann.id) as any;
  assert.equal(v.item.public.count, 3);
  assert.equal(v.item.input.kind, "texts");
  assert.throws(() => submit(g, ann.id, { items: ["a", "b", "c", "d"] }), /at most 3/);
  submit(g, ann.id, { items: ["a", "b", "c"], extra: "d" });
  submit(g, bob.id, { items: ["a", "zzz"], extra: "b" });
  const h = hostView(g) as any;
  assert.match(h.answers.find((x: any) => x.nickname === "Bob").value.extra, /b/);
  finish(g);
  assert.deepEqual(hostView(g).leaderboard.map((r) => [r.nickname, r.points]), [["Ann", 5], ["Bob", 1]]);
});

test("nsome in a game: the extra box is refused unless the host turned it on, and the host can award it by hand", () => {
  const { g, ann, bob } = play({});
  assert.throws(() => submit(g, ann.id, { items: ["a"], extra: "b" }), /no extra box/);
  submit(g, bob.id, { items: ["a", "zzz"] });
  act(g, { action: "close" });
  const ans = (hostView(g) as any).answers[0];
  assert.equal(ans.full, 5, "Right awards the most it can be worth");
  act(g, { action: "review", answerId: ans.id, points: 2 });
  act(g, { action: "reveal" });
  act(g, { action: "end" });
  assert.equal(hostView(g).leaderboard.find((r) => r.nickname === "Bob")!.points, 2);
});
