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

test("stylesheet braces balance, so one bad edit cannot swallow the rules below it", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    assert.ok(depth >= 0, "closing brace without an opening one");
  }
  assert.equal(depth, 0, "unclosed brace in styles.css");
});

test("numbering counts consecutive questions of the same section, restarting for each run", () => {
  const rounds = roundsSchema.parse([
    { title: "Round 1", modules: [
      { ...textQ(["a"]), section: "Hodgepodge" }, { ...textQ(["b"]), section: "Hodgepodge" }, { ...textQ(["c"]), section: "Hodgepodge" },
      { ...conf(["x"]), section: "Confidence" }, { ...conf(["y"]), section: "Confidence" },
    ] },
    { title: "Round 2", modules: [textQ(["d"]), textQ(["e"])] },
  ]);
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds, code: "ABCDE", maxGuesses: 3 });
  joinPlayer(g, "Ann");
  act(g, { action: "begin" });
  const seen: string[] = [];
  for (let i = 0; i < 7; i++) {
    const it = hostView(g).item!;
    seen.push(`${it.round}|${it.section ?? ""}|${it.pos.n}/${it.pos.of}`);
    act(g, { action: "next" });
  }
  assert.deepEqual(seen, [
    "Round 1|Hodgepodge|1/3", "Round 1|Hodgepodge|2/3", "Round 1|Hodgepodge|3/3",
    "Round 1|Confidence|1/2", "Round 1|Confidence|2/2", "Round 2||1/2", "Round 2||2/2",
  ]);
});

test("the theme goes public when round two starts, or once every player has found it", () => {
  const two = [{ title: "R1", modules: [textQ(["a"])] }, { title: "R2", modules: [textQ(["b"])] }];
  const a1 = start(two, { secret: "oo", hint: "h", formal: "f" });
  assert.equal(playerView(a1.g, a1.a.id).theme?.revealed, false);
  act(a1.g, { action: "next" });
  assert.equal(playerView(a1.g, a1.a.id).theme?.revealed, true, "round two");

  const one = start([{ title: "R1", modules: [textQ(["a"]), textQ(["b"])] }], { secret: "oo", hint: "h", formal: "f" });
  act(one.g, { action: "next" });
  submitTheme(one.g, one.a.id, "oo sounds");
  submitTheme(one.g, one.b.id, "double o");
  const [ga, gb] = hostView(one.g).theme!.guesses;
  act(one.g, { action: "theme_review", guessId: ga!.id, points: 3 });
  assert.equal(hostView(one.g).theme!.revealed, false, "one player still has not found it");
  act(one.g, { action: "theme_review", guessId: gb!.id, points: 3 });
  assert.equal(hostView(one.g).theme!.revealed, true, "everyone has");
});

test("older trivias with separate clue boxes fold into one question", () => {
  const r = roundsSchema.parse([{ title: "R", modules: [{ type: "text_qa", config: {
    clue1: "Its flag is no rectangle.", clue2: "Home to Everest.", question: "Which country?", answers: ["Nepal"], category: "Geo", tier: "Layup", answerType: "Country",
  } }] }]);
  assert.equal(r[0]!.modules[0]!.config.question, "Its flag is no rectangle. Home to Everest.\n\nWhich country?");
  assert.equal("clue1" in r[0]!.modules[0]!.config, false);
  assert.equal("tier" in r[0]!.modules[0]!.config, false);
});

test("theme bonus: suggested points start at the configured bonus and shrink one per question, never below 1", async () => {
  const { suggestedThemePoints } = await import("../src/game.js");
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => suggestedThemePoints(n)), [4, 3, 2, 1, 1, 1], "default bonus 4");
  assert.deepEqual([1, 2, 3, 6, 7, 20].map((n) => suggestedThemePoints(n, 6)), [6, 5, 4, 1, 1, 1]);
  assert.deepEqual([1, 2, 3].map((n) => suggestedThemePoints(n, 2)), [2, 1, 1]);
  assert.deepEqual([1, 2].map((n) => suggestedThemePoints(n, 0.5)), [0.5, 0.5], "a bonus below 1 is never raised");
  const { g, a } = start([{ title: "R", modules: [textQ(["a"]), textQ(["b"])] }], { secret: "x", hint: "h", formal: "f", bonus: 6 });
  submitTheme(g, a.id, "guess");
  const view = hostView(g).theme!;
  assert.equal(view.bonus, 6);
  assert.equal(view.guesses[0]!.suggested, 6);
});
