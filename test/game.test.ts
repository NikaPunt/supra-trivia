import { test } from "node:test";
import assert from "node:assert/strict";
import { act, hostView, joinPlayer, newGame, playerView, submit, submitTheme, type Game } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";

const textQ = (answers: string[], extra: object = {}) => ({ type: "text_qa", config: { question: "q", answers, ...extra } });
const conf = (answers: string[]) => ({ type: "confidence", config: { question: "q", answers, poolId: "set", poolValues: [8, 6] } });

function start(rounds: unknown[], theme?: Game["theme"]) {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse(rounds), code: "ABCDE", maxGuesses: 3, theme: theme ?? undefined });
  const a = joinPlayer(g, "Ann").player;
  const b = joinPlayer(g, "Bob").player;
  act(g, { action: "begin" });
  return { g, a, b };
}

test("confidence pool: each value is spendable once per player, and a stake is the score", () => {
  const { g, a, b } = start([{ title: "R", modules: [conf(["x"]), conf(["y"])] }]);
  assert.deepEqual(playerView(g, a.id).stake?.options, [8, 6]);
  assert.throws(() => submit(g, a.id, { text: "x", bet: 7 }), /valid value/);
  submit(g, a.id, { text: "x", bet: 8 });
  submit(g, b.id, { text: "wrong", bet: 6 });
  act(g, { action: "reveal" });
  act(g, { action: "next" });
  assert.deepEqual(playerView(g, a.id).stake?.options, [6], "8 is spent");
  assert.deepEqual(playerView(g, b.id).stake?.options, [8, 6].filter((v) => v !== 6), "6 is spent even though Bob was wrong");
  assert.throws(() => submit(g, a.id, { text: "y", bet: 8 }), /valid value/);
  submit(g, a.id, { text: "y", bet: 6 });
  act(g, { action: "end" });
  const board = hostView(g).leaderboard;
  assert.deepEqual(board.map((r) => [r.nickname, r.points]), [["Ann", 14], ["Bob", 0]]);
});

test("wager: right wins the wager, wrong loses it, host can still override", () => {
  const { g, a, b } = start([{ title: "R", modules: [{ type: "wager", config: { question: "q", answers: ["yes"], maxWager: 20 } }] }]);
  assert.throws(() => submit(g, a.id, { text: "yes", wager: 21 }), /valid value/);
  submit(g, a.id, { text: "YES", wager: 15 });
  submit(g, b.id, { text: "no", wager: 10 });
  act(g, { action: "reveal" });
  let hv = hostView(g);
  const bobAns = hv.answers.find((x) => x.nickname === "Bob")!;
  assert.equal(bobAns.points, -10);
  assert.equal(bobAns.full, 10);
  assert.equal(bobAns.wrong, -10);
  act(g, { action: "review", answerId: bobAns.id, points: 5 });
  act(g, { action: "end" });
  hv = hostView(g);
  assert.deepEqual(hv.leaderboard.map((r) => [r.nickname, r.points]), [["Ann", 15], ["Bob", 5]]);
});

test("leaderboards only appear at the end of a round and at the end of the game", () => {
  const { g, a } = start([{ title: "R1", modules: [textQ(["a"]), textQ(["b"])] }, { title: "R2", modules: [textQ(["c"])] }]);
  submit(g, a.id, { text: "a" });
  act(g, { action: "reveal" });
  assert.equal(playerView(g, a.id).leaderboard, null);
  act(g, { action: "next" });
  submit(g, a.id, { text: "b" });
  act(g, { action: "reveal" });
  assert.equal(playerView(g, a.id).leaderboard?.[0]?.points, 2, "last question of round 1");
  act(g, { action: "next" });
  act(g, { action: "reveal" });
  assert.equal(playerView(g, a.id).leaderboard?.[0]?.points, 2, "last question of the game");
});

test("secret theme: points are suggested by how early, counted only after reveal, one bonus per player", () => {
  const { g, a, b } = start([{ title: "R", modules: [textQ(["a"]), textQ(["b"]), textQ(["c"])] }], { secret: "oo", hint: "h", formal: "f" });
  act(g, { action: "next" });
  submitTheme(g, a.id, "double o");
  submitTheme(g, a.id, "oo sounds");
  submitTheme(g, b.id, "colors");
  const guesses = hostView(g).theme!.guesses;
  assert.deepEqual(guesses.map((t) => t.suggested), [3, 3, 3], "made at question 2");
  act(g, { action: "theme_review", guessId: guesses[0]!.id, points: 3 });
  act(g, { action: "theme_review", guessId: guesses[1]!.id, points: 6 });
  act(g, { action: "theme_review", guessId: guesses[2]!.id, points: 0 });
  assert.equal(hostView(g).leaderboard.find((r) => r.nickname === "Ann")!.points, 0, "hidden until reveal");
  act(g, { action: "theme_reveal" });
  assert.equal(hostView(g).theme!.guesses.length, 0, "guesses are cleared on reveal");
  assert.equal(hostView(g).leaderboard.find((r) => r.nickname === "Ann")!.points, 6, "best guess only, not 3 + 6");
  assert.equal(playerView(g, a.id).theme?.secret, "oo");
  assert.throws(() => submitTheme(g, a.id, "late"), /revealed/);
});

test("PIN rejoin: right PIN returns the same player; wrong PINs lock after 10", () => {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules: [textQ(["a"])] }]), code: "ABCDE", maxGuesses: 3 });
  const first = joinPlayer(g, "Team Rocket", "4321").player;
  assert.equal(joinPlayer(g, "team rocket", "4321").player.id, first.id);
  assert.equal(g.players.length, 1);
  assert.throws(() => joinPlayer(g, "Team Rocket"), /taken/);
  assert.throws(() => joinPlayer(g, "Team Rocket", "12"), /4 digits/);
  for (let i = 0; i < 10; i++) assert.throws(() => joinPlayer(g, "Team Rocket", "0000"));
  assert.throws(() => joinPlayer(g, "Team Rocket", "4321"), /too many/);
  assert.ok(!JSON.stringify(playerView(g, first.id)).includes(first.pin!.hash));
  assert.ok(!JSON.stringify(hostView(g)).includes(first.pin!.hash));
});
