import { test } from "node:test";
import assert from "node:assert/strict";
import { act, hostView, joinPlayer, newGame, playerView, setWager, submit, items, type Game } from "../src/game.js";
import { getModule, roundsSchema } from "../src/modules/index.js";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

// What a player must never be able to do: spend a confidence value twice, or wager outside the limits.

const conf = (answer: string, poolId = "p", poolValues = [8, 6, 4, 2]) => ({ type: "confidence", config: { question: "q", answers: [answer], poolId, poolValues } });
const wagerQ = (maxWager = 20) => ({ type: "wager", config: { question: "q", answers: ["yes"], maxWager } });
const jeop = (maxWager = 20) => ({ type: "jeopardy", config: { category: "Birds", question: "Secret clue text", answers: ["yes"], maxWager } });

function game(modules: object[], timeLimit = 0) {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules }]), code: "ABCDE", maxGuesses: 3, timeLimit });
  const ann = joinPlayer(g, "Ann").player, bob = joinPlayer(g, "Bob").player;
  act(g, { action: "begin" });
  return { g, ann, bob };
}
const finish = (g: Game) => { if (g.phase === "open") act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" }); };
const options = (g: Game, id: string) => playerView(g, id).stake?.options ?? null;

// A pile of values a hostile or buggy client might send where a number belongs.
const NOT_NUMBERS: [string, unknown][] = [["a string", "8"], ["a list", [8]], ["an object", { v: 8 }], ["null", null], ["undefined", undefined], ["true", true]];
const BAD_NUMBERS: [string, number][] = [["negative", -1], ["fraction", 2.5], ["tiny fraction", 0.0000001], ["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["huge", 1e9], ["beyond safe integers", 2 ** 53]];

// ---------------------------------------------------------------- confidence

test("a confidence value can be used once: each later question offers only what is left", () => {
  const { g, ann } = game([conf("a"), conf("b"), conf("c"), conf("d"), conf("e")]);
  const used: number[] = [];
  const left = (): number[] => [8, 6, 4, 2].filter((v) => !used.includes(v));
  for (const pick of [6, 2, 8, 4]) {
    assert.deepEqual(options(g, ann.id)!.slice().sort(), left().sort(), "exactly the unspent values are offered");
    for (const spent of used) assert.throws(() => submit(g, ann.id, { text: "a", bet: spent }), /valid value/, `${spent} was already spent`);
    submit(g, ann.id, { text: "a", bet: pick });
    used.push(pick);
    finish(g);
  }
  assert.deepEqual(options(g, ann.id), [], "all four are spent");
  for (const v of [8, 6, 4, 2, 0, 1, 99]) assert.throws(() => submit(g, ann.id, { text: "a", bet: v }), /valid value/, `nothing is left to bet, not even ${v}`);
});

test("only the pool's own values are accepted, however they are written", () => {
  const { g, ann } = game([conf("a")]);
  for (const v of [0, 1, 3, 5, 7, 9, 10, 100, 4.0000001]) assert.throws(() => submit(g, ann.id, { text: "a", bet: v }), /valid value/, `${v} is not in the pool`);
  for (const [why, v] of BAD_NUMBERS) assert.throws(() => submit(g, ann.id, { text: "a", bet: v }), undefined, `${why} is refused`);
  for (const [why, v] of NOT_NUMBERS) assert.throws(() => submit(g, ann.id, { text: "a", bet: v }), undefined, `${why} is refused`);
  assert.throws(() => submit(g, ann.id, { text: "a" }), undefined, "a missing stake is refused");
  assert.equal(g.answers.length, 0, "none of that left an answer behind");
  assert.equal(g.attempts[ann.id] ?? 0, 0, "and none used up a guess");
  submit(g, ann.id, { text: "a", bet: 8 });
});

test("changing a stake before the question ends spends only the final one", () => {
  const { g, ann } = game([conf("a"), conf("b")]);
  submit(g, ann.id, { text: "a", bet: 8 });
  submit(g, ann.id, { text: "a2", bet: 6 }); // changed their mind
  assert.deepEqual(options(g, ann.id)!.slice().sort(), [2, 4, 6, 8], "nothing is spent while the question is still open");
  finish(g);
  assert.deepEqual(options(g, ann.id)!.slice().sort(), [2, 4, 8], "only the 6 they ended on is gone");
  assert.throws(() => submit(g, ann.id, { text: "b", bet: 6 }), /valid value/);
  submit(g, ann.id, { text: "b", bet: 8 });
});

test("skipping a question spends nothing, a wrong answer still spends its stake, and players do not share a pool", () => {
  const { g, ann, bob } = game([conf("a"), conf("b")]);
  submit(g, ann.id, { text: "WRONG", bet: 8 }); // Bob does not answer at all
  finish(g);
  assert.deepEqual(options(g, ann.id)!.slice().sort(), [2, 4, 6], "Ann was wrong but 8 is spent");
  assert.deepEqual(options(g, bob.id)!.slice().sort(), [2, 4, 6, 8], "Bob skipped, so he still has all four");
  submit(g, bob.id, { text: "b", bet: 8 });
});

test("pools are separate by name, and a pool with a repeated value allows exactly that many uses", () => {
  const { g: g1, ann } = game([conf("a", "one"), conf("b", "two")]);
  submit(g1, ann.id, { text: "a", bet: 8 }); finish(g1);
  assert.ok(options(g1, ann.id)!.includes(8), "a different pool starts full again");

  const { g, ann: a2 } = game([conf("a", "p", [4, 4, 2]), conf("b", "p", [4, 4, 2]), conf("c", "p", [4, 4, 2])]);
  submit(g, a2.id, { text: "a", bet: 4 }); finish(g);
  submit(g, a2.id, { text: "b", bet: 4 }); finish(g);
  assert.throws(() => submit(g, a2.id, { text: "c", bet: 4 }), /valid value/, "both 4s are spent");
  submit(g, a2.id, { text: "c", bet: 2 });
});

test("a removed player can no longer stake anything", () => {
  const { g, ann } = game([conf("a")]);
  act(g, { action: "kick", playerId: ann.id });
  assert.throws(() => submit(g, ann.id, { text: "a", bet: 8 }), /not in this session/);
});

// ---------------------------------------------------------------- wagers

test("a wager is a whole number from 0 to the maximum, and nothing else is accepted", () => {
  const { g, ann } = game([wagerQ(20)]);
  for (const [why, v] of [...BAD_NUMBERS, ["just over the maximum", 21], ["far over", 1000], ["one below zero", -1], ["fractional", 19.5]] as [string, number][]) {
    assert.throws(() => submit(g, ann.id, { text: "yes", wager: v }), undefined, `${why} (${v}) is refused`);
  }
  for (const [why, v] of NOT_NUMBERS) assert.throws(() => submit(g, ann.id, { text: "yes", wager: v }), undefined, `${why} is refused`);
  assert.throws(() => submit(g, ann.id, { text: "yes" }), undefined, "no wager at all is refused");
  assert.equal(g.answers.length, 0, "none of those left an answer behind");
  submit(g, ann.id, { text: "yes", wager: 0 });
  submit(g, ann.id, { text: "yo", wager: 20 });
  assert.equal(g.answers.at(-1)!.points, 0, "answers are scored at the reveal, not before");
});

test("a wager can never win or lose more than the maximum", () => {
  const { g, ann, bob } = game([wagerQ(20)]);
  submit(g, ann.id, { text: "yes", wager: 20 });
  submit(g, bob.id, { text: "no", wager: 20 });
  act(g, { action: "close" }); act(g, { action: "reveal" });
  const pts = Object.fromEntries(hostView(g).answers.map((a) => [a.nickname, a.points]));
  assert.deepEqual(pts, { Ann: 20, Bob: -20 });
  assert.ok(Object.values(pts).every((p) => Math.abs(p) <= 20));
  act(g, { action: "next" });
  assert.ok(Object.values(g.scores).every((s) => Number.isFinite(s) && Math.abs(s) <= 20));
});

// ---------------------------------------------------------------- final jeopardy

test("Final Jeopardy: wager on the category alone, bounds enforced, locked once the question is shown", () => {
  const { g, ann, bob } = game([jeop(20)], 60);
  const stage = () => playerView(g, ann.id).item!;
  assert.equal(stage().stage, "wager");
  assert.ok(!JSON.stringify(playerView(g, ann.id)).includes("Secret clue text"), "the question is not in what a player receives");
  assert.ok(!JSON.stringify(playerView(g, ann.id)).includes('"yes"'), "nor is the answer");
  assert.match(String(stage().public.question), /Category: Birds/);
  assert.equal(g.deadline, null, "no clock yet");

  assert.throws(() => submit(g, ann.id, { text: "yes" }), /not been shown/, "no answering before the question");
  assert.throws(() => act(g, { action: "close" }), /show the question first/);
  for (const [why, v] of [...BAD_NUMBERS, ["over", 21], ["fraction", 0.5], ["string", "5"] as [string, unknown], ["null", null], ["undefined", undefined]] as [string, unknown][]) {
    assert.throws(() => setWager(g, ann.id, v), undefined, `a wager of ${why} is refused`);
  }
  assert.equal(g.wagers?.[ann.id], undefined, "nothing was recorded by those");

  setWager(g, ann.id, 7);
  setWager(g, ann.id, 20); // changing it is fine until the question is shown
  setWager(g, bob.id, 0);
  assert.equal(playerView(g, ann.id).myWager, 20);
  assert.equal(hostView(g).wagers!.find((w) => w.nickname === "Ann")!.wager, 20);

  act(g, { action: "showclue" });
  assert.ok(g.deadline! > Date.now(), "the answer clock starts when the question is shown");
  assert.match(String(playerView(g, ann.id).item!.public.question), /Secret clue text/, "now they can read it");
  assert.throws(() => setWager(g, ann.id, 1), /locked/, "wagers are locked once the question is up");
  assert.throws(() => act(g, { action: "showclue" }), /already shown/);

  // Whatever a phone sends as a wager is ignored: the locked one is used.
  submit(g, ann.id, { text: "yes", wager: 999 } as any);
  submit(g, bob.id, { text: "nope", wager: 20 } as any);
  act(g, { action: "close" }); act(g, { action: "reveal" });
  const pts = Object.fromEntries(hostView(g).answers.map((a) => [a.nickname, a.points]));
  assert.deepEqual(pts, { Ann: 20, Bob: 0 }, "Ann's locked 20 won; Bob locked 0, so being wrong cost nothing");
});

test("Final Jeopardy: no wager means 0, and the step cannot be used where it does not belong", () => {
  const { g, ann } = game([jeop(20), { type: "text_qa", config: { question: "q", answers: ["a"] } }]);
  act(g, { action: "showclue" });
  submit(g, ann.id, { text: "WRONG" }); // never wagered
  act(g, { action: "close" }); act(g, { action: "reveal" });
  assert.equal(hostView(g).answers[0]!.points, 0, "no wager, so nothing to lose");
  act(g, { action: "next" });
  assert.throws(() => setWager(g, ann.id, 5), /no wager to place/, "an ordinary question has no wager step");
  assert.throws(() => act(g, { action: "showclue" }), /no wager step/);
});

test("Final Jeopardy: wagers wait out a pause, and do not carry over to the next question", () => {
  const { g, ann } = game([jeop(20), jeop(10)]);
  act(g, { action: "pause" });
  assert.throws(() => setWager(g, ann.id, 5), /paused/);
  act(g, { action: "resume" });
  setWager(g, ann.id, 15);
  act(g, { action: "showclue" }); act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" });
  assert.equal(playerView(g, ann.id).myWager, null, "the next question starts with no wager");
  assert.equal(playerView(g, ann.id).item!.stage, "wager");
  assert.throws(() => setWager(g, ann.id, 11), /0 to 10/, "and its own maximum applies");
  setWager(g, ann.id, 10);
});

// ---------------------------------------------------------------- stress

test("stress: thousands of random actions, valid and hostile, never break a rule", () => {
  let seed = 12345;
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  const pools = [8, 6, 4, 2];
  const accepted = { bets: 0, wagers: 0, answers: 0, clues: 0, refused: 0 };
  const junk = [-5, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 19, 20, 21, 100, 1e9, 2.5, NaN, Infinity, "8", null, undefined, [8], { a: 1 }] as unknown[];
  for (let round = 0; round < 30; round++) {
    const { g, ann, bob } = game([conf("a"), conf("b"), conf("c"), conf("d"), wagerQ(20), jeop(20), jeop(10), conf("e", "other")]);
    const who = [ann, bob];
    for (let step = 0; step < 500 && g.phase !== "ended"; step++) {
      const p = who[rnd(2)]!;
      const it = items(g)[g.cursor];
      const roll = rnd(10);
      try {
        if (roll < 4) { const bet = rnd(3) ? [8, 6, 4, 2][rnd(4)] : junk[rnd(junk.length)]; const wager = rnd(3) ? rnd(22) : junk[rnd(junk.length)]; submit(g, p.id, { text: rnd(2) ? "a" : "yes", bet, wager }); accepted.answers++; if (it?.type === "confidence") accepted.bets++; if (it?.type === "wager") accepted.wagers++; }
        else if (roll < 6) { setWager(g, p.id, rnd(3) ? rnd(22) : junk[rnd(junk.length)]); accepted.wagers++; }
        else if (roll === 6) { act(g, { action: "showclue" }); accepted.clues++; }
        else if (roll === 7) act(g, { action: "close" });
        else if (roll === 8) act(g, { action: "reveal" });
        else act(g, { action: "next" });
      } catch { accepted.refused++; /* refused: that is the point */ }

      // The rules, after every single action.
      for (const a of g.answers) {
        const v = a.value as Record<string, unknown>;
        const cur = items(g)[g.cursor]!;
        if (cur.type === "confidence") assert.ok(pools.includes(v.bet as number) || (cur.config.poolValues as number[]).includes(v.bet as number), "a confidence bet is a value from its pool");
        if (cur.type === "wager" || cur.type === "jeopardy") assert.ok(Number.isInteger(v.wager) && (v.wager as number) >= 0 && (v.wager as number) <= cur.config.maxWager, `a wager is a whole number from 0 to ${cur.config.maxWager}`);
      }
      for (const [pid, w] of Object.entries(g.wagers ?? {})) {
        const cur = items(g)[g.cursor];
        assert.ok(cur && Number.isInteger(w) && w >= 0 && w <= getModule(cur.type)!.twoStep!.max(cur.config), `stored wager of ${w} is in bounds`);
        assert.ok(who.some((x) => x.id === pid));
      }
      for (const [pool, byPlayer] of Object.entries(g.poolUsed)) for (const spent of Object.values(byPlayer)) {
        const values = pool === "other" ? [8, 6, 4, 2] : [8, 6, 4, 2];
        const left = [...values];
        for (const v of spent) { const i = left.indexOf(v); assert.ok(i >= 0, `${v} was spent more often than it exists in pool ${pool}`); left.splice(i, 1); }
      }
      for (const s of Object.values(g.scores)) assert.ok(Number.isFinite(s));
    }
  }
  // The run must have actually exercised the rules: plenty accepted, and plenty refused.
  assert.ok(accepted.bets > 100 && accepted.wagers > 100 && accepted.clues > 30 && accepted.refused > 2000, `the stress run did real work: ${JSON.stringify(accepted)}`);
});

// ---------------------------------------------------------------- over HTTP

test("forged requests: hostile stakes and wagers are refused with a clean error, and change nothing", async () => {
  const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
  const app = await buildApp(cfg, openDb(":memory:"), HostDirectory.fromLists({ admins: ["o@example.com"] }));
  const host = { cookie: "trivia_session=" + (await signSession(cfg, { email: "o@example.com", name: "O" })), origin: cfg.BASE_URL };
  const trivia = { title: "t", settings: { maxGuesses: 0, timeLimit: 0 }, rounds: [{ title: "R", modules: [conf("a"), conf("b"), jeop(20)] }] };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: host })).json();
  const act = (a: object) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: a });
  const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "Ann" } });
  const p = { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL, "content-type": "application/json" };
  const raw = (url: string, body: string) => app.inject({ method: "POST", url, headers: p, payload: body });
  const state = async () => (await app.inject({ url: "/api/play/state", headers: p })).json();
  await act({ action: "begin" });

  // Stakes, hand-written the way a forged request would carry them, including numbers JSON can express but JavaScript cannot hold.
  const hostile = ['"8"', "[8]", "null", "true", "{}", "-8", "2.5", "0", "9", "1e999", "-1e999", "123456789012345678901234567890", "8.000000001", "1e-9", "NaN", "Infinity", '"\\u0038"'];
  for (const bet of hostile) {
    const r = await raw("/api/play/answer", `{"value":{"text":"a","bet":${bet}}}`);
    assert.ok([400, 409].includes(r.statusCode), `bet ${bet} must be a clean refusal, got ${r.statusCode}`);
  }
  assert.equal((await state()).myAnswers.length, 0, "no hostile stake recorded an answer");
  assert.equal((await raw("/api/play/answer", `{"value":{"text":"a","bet":8}}`)).statusCode, 200, "a real one still works");

  // Spend it, then try to spend it again on the next question.
  await act({ action: "close" }); await act({ action: "reveal" }); await act({ action: "next" });
  const again = await raw("/api/play/answer", `{"value":{"text":"b","bet":8}}`);
  assert.equal(again.statusCode, 400, "the 8 is spent");
  assert.ok(!(await state()).stake.options.includes(8), "and the screen no longer offers it");
  assert.equal((await raw("/api/play/answer", `{"value":{"text":"b","bet":6}}`)).statusCode, 200);

  // Final Jeopardy over the wire.
  await act({ action: "close" }); await act({ action: "reveal" }); await act({ action: "next" });
  assert.equal((await state()).item.stage, "wager");
  for (const w of ['"5"', "[5]", "null", "-1", "21", "20.5", "1e999", "99999999999", "true", "{}", "NaN"]) {
    const r = await raw("/api/play/wager", `{"value":${w}}`);
    assert.ok([400, 409].includes(r.statusCode), `wager ${w} must be a clean refusal, got ${r.statusCode}`);
  }
  assert.equal((await state()).myWager, null, "no hostile wager was stored");
  assert.equal((await raw("/api/play/wager", `{"value":20}`)).statusCode, 200);
  assert.equal((await raw("/api/play/answer", `{"value":{"text":"yes"}}`)).statusCode, 409, "cannot answer before the question is shown");
  assert.equal((await act({ action: "showclue" })).statusCode, 200);
  assert.equal((await raw("/api/play/wager", `{"value":1}`)).statusCode, 409, "wagers are locked");
  assert.equal((await raw("/api/play/answer", `{"value":{"text":"yes","wager":999}}`)).statusCode, 200, "a forged wager inside the answer is simply ignored");
  await act({ action: "close" }); await act({ action: "reveal" });
  assert.equal((await app.inject({ url: `/api/sessions/${id}`, headers: host })).json().answers[0].points, 20, "scored with the locked 20, not 999");

  // The host's own point awards are bounded too.
  for (const points of [1001, -1001, 0.3, 1e9]) {
    const r = await act({ action: "review", answerId: "00000000-0000-4000-8000-000000000000", points });
    assert.equal(r.statusCode, 400, `a manual award of ${points} is refused`);
  }
  await app.close();
});

// ---------------------------------------------------------------- wager capped by team score

const capGame = (modules: object[], wagerCap: boolean) => {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse([{ title: "R", modules }]), code: "ABCDE", maxGuesses: 3, wagerCap });
  const ann = joinPlayer(g, "Ann").player, bob = joinPlayer(g, "Bob").player;
  act(g, { action: "begin" });
  return { g, ann, bob };
};
const plain = (answer: string, points = 5) => ({ type: "text_qa", config: { question: "q", answers: [answer], points } });

test("wager cap on: a wager can be at most the team's score, whatever the question's own maximum", () => {
  const { g, ann, bob } = capGame([plain("a"), plain("b"), wagerQ(50), wagerQ(50)], true);
  submit(g, ann.id, { text: "a" }); // Ann scores 5, Bob scores nothing
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" });
  submit(g, ann.id, { text: "b" });
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" }); // Ann has 10
  assert.equal(playerView(g, ann.id).stake?.max, 10, "the wager box is limited to her 10 points");
  assert.equal(playerView(g, bob.id).stake?.max, 0, "a team on zero cannot wager");
  assert.throws(() => submit(g, ann.id, { text: "yes", wager: 11 }), /valid value/, "one over her score is refused");
  assert.throws(() => submit(g, bob.id, { text: "yes", wager: 1 }), /valid value/, "a team on zero cannot wager anything");
  submit(g, ann.id, { text: "yes", wager: 10 });
  submit(g, bob.id, { text: "yes", wager: 0 });
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" }); // Ann 20, Bob 0
  assert.equal(playerView(g, ann.id).stake?.max, 20, "the cap follows her score, not the question maximum of 50");
});

test("wager cap on: Final Jeopardy wagers are capped by score too, and a fractional score rounds down", () => {
  const { g, ann, bob } = capGame([plain("a", 4.5), jeop(50)], true);
  submit(g, ann.id, { text: "a" });
  act(g, { action: "close" }); act(g, { action: "reveal" }); act(g, { action: "next" }); // Ann 4.5, Bob 0
  assert.equal(playerView(g, ann.id).item.wagerMax, 4, "4.5 points allows a wager of 4");
  assert.equal(playerView(g, bob.id).item.wagerMax, 0);
  assert.throws(() => setWager(g, ann.id, 5), undefined, "5 is over her score");
  assert.throws(() => setWager(g, bob.id, 1), undefined, "Bob has nothing to wager");
  setWager(g, ann.id, 4);
  setWager(g, bob.id, 0);
  assert.equal(g.wagers?.[ann.id], 4);
});

test("wager cap off (the default): the question's own maximum applies, whatever the score", () => {
  const { g, bob } = capGame([wagerQ(20)], false);
  assert.equal(playerView(g, bob.id).stake?.max, 20);
  submit(g, bob.id, { text: "yes", wager: 20 });
});
