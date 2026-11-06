import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { act, hostView, joinPlayer, newGame } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";

// Every size, count and amount the app limits, pushed one step past its edge.

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com"] });
const q = (extra: object = {}, type = "text_qa") => ({ type, config: { question: "q", answers: ["a"], ...extra } });
const trivia = (modules: object[] = [q()], extra: object = {}) => ({ title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds: [{ title: "R", modules }], ...extra });

/** Headers for a request that has no body: the browser never sends a JSON type with those. */
const bare = (h: object) => { const { "content-type": _drop, ...rest } = h as Record<string, string>; return rest; };

async function setup() {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const as = async (email: string) => ({ cookie: "trivia_session=" + (await signSession(cfg, { email, name: email })), origin: cfg.BASE_URL, "content-type": "application/json" });
  const save = async (h: object, body: unknown) => app.inject({ method: "POST", url: "/api/trivias", headers: h as any, payload: typeof body === "string" ? body : JSON.stringify(body) });
  return { app, as, save };
}
const refused = (r: { statusCode: number }, why: string) => assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${why}: expected a clean 4xx refusal, got ${r.statusCode}`);

test("a trivia cannot be saved with anything past its limits", async () => {
  const { app, as, save } = await setup();
  const a = await as("a@example.com");
  const ok = async (body: unknown, why: string) => assert.equal((await save(a, body)).statusCode, 201, `${why} should save`);
  const no = async (body: unknown, why: string) => refused(await save(a, body), why);

  await ok(trivia(), "a plain trivia");
  await ok({ ...trivia(), title: "x".repeat(120) }, "a 120-character title");
  await no({ ...trivia(), title: "x".repeat(121) }, "a 121-character title");
  await no({ ...trivia(), title: "" }, "an empty title");
  await ok(trivia([q({ question: "x".repeat(1200) })]), "a 1200-character question");
  await no(trivia([q({ question: "x".repeat(1201) })]), "a 1201-character question");
  await ok(trivia([q({ answers: Array(20).fill("a").map((x, i) => x + i) })]), "20 accepted answers");
  await no(trivia([q({ answers: Array(21).fill("a").map((x, i) => x + i) })]), "21 accepted answers");
  await no(trivia([q({ answers: [] })]), "no answers at all");
  await no(trivia([q({ answers: ["x".repeat(201)] })]), "a 201-character answer");
  await ok(trivia([q({ points: 1000 })]), "1000 points");
  await no(trivia([q({ points: 1001 })]), "1001 points");
  await no(trivia([q({ points: -1 })]), "negative points");
  await no(trivia([q({ points: 1.3 })]), "points not in halves");
  await ok(trivia([q({ points: 1.5 })]), "points in halves");
  await ok({ title: "t", settings: { maxGuesses: 50, timeLimit: 3600 }, rounds: trivia().rounds }, "the largest guess limit and time");
  await no({ title: "t", settings: { maxGuesses: 51, timeLimit: 0 }, rounds: trivia().rounds }, "51 guesses");
  await no({ title: "t", settings: { maxGuesses: 3, timeLimit: 3601 }, rounds: trivia().rounds }, "a time limit over an hour");
  await no({ title: "t", settings: { maxGuesses: 3, timeLimit: -1 }, rounds: trivia().rounds }, "a negative time limit");
  await no({ title: "t", settings: { maxGuesses: 2.5, timeLimit: 10 }, rounds: trivia().rounds }, "half a guess");

  const rounds = (n: number, perRound = 1) => Array.from({ length: n }, (_, i) => ({ title: `R${i}`, modules: Array.from({ length: perRound }, () => q()) }));
  await ok({ title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds: rounds(30) }, "30 rounds");
  await no({ title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds: rounds(31) }, "31 rounds");
  await ok({ title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds: rounds(1, 50) }, "50 questions in a round");
  await no({ title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds: rounds(1, 51) }, "51 questions in a round");

  await no(trivia([{ type: "multiple_choice", config: { question: "q", options: ["a"], correct: 0 } }]), "a multiple choice with one option");
  await no(trivia([{ type: "multiple_choice", config: { question: "q", options: Array(7).fill("x").map((x, i) => x + i), correct: 0 } }]), "7 options");
  await no(trivia([{ type: "multiple_choice", config: { question: "q", options: ["a", "b"], correct: 2 } }]), "a correct option that does not exist");
  await no(trivia([{ type: "confidence", config: { question: "q", answers: ["a"], poolId: "p", poolValues: [8] } }]), "a confidence pool of one value");
  await no(trivia([{ type: "confidence", config: { question: "q", answers: ["a"], poolId: "p", poolValues: Array(11).fill(1).map((x, i) => x + i) } }]), "a pool of 11 values");
  await no(trivia([{ type: "confidence", config: { question: "q", answers: ["a"], poolId: "p", poolValues: [8, -6] } }]), "a negative pool value");
  await no(trivia([{ type: "wager", config: { question: "q", answers: ["a"], maxWager: 1001 } }]), "a maximum wager of 1001");
  await no(trivia([{ type: "wager", config: { question: "q", answers: ["a"], maxWager: 0 } }]), "a maximum wager of 0");
  await no(trivia([{ type: "jeopardy", config: { category: "", question: "q", answers: ["a"], maxWager: 20 } }]), "a Final Jeopardy with no category");
  await no(trivia([{ type: "jeopardy", config: { category: "c", question: "q", answers: ["a"], maxWager: 20.5 } }]), "a fractional maximum wager");
  await no(trivia([{ type: "numeric_closest", config: { question: "q", value: 1e300 } }]), "a true number of 1e300");
  await no(trivia([{ type: "numeric_closest", config: { question: "q", value: -1e16 } }]), "a true number below -1e15");
  await ok(trivia([{ type: "numeric_closest", config: { question: "q", value: 1e15 } }]), "a true number of 1e15");
  await no(trivia([{ type: "nope", config: {} }]), "an unknown question type");
  await no(trivia([q({ timeLimit: 1 })].map((m: any) => ({ ...m, timeLimit: 3601 }))), "a per-question time over an hour");
  await no(trivia([q()].map((m: any) => ({ ...m, maxGuesses: 51 }))), "a per-question guess limit of 51");
  await app.close();
});

test("bad requests get a clean refusal, never a crash: broken JSON, huge bodies, wrong shapes", async () => {
  const { app, as, save } = await setup();
  const a = await as("a@example.com");
  refused(await save(a, "{ this is not json"), "broken JSON");
  refused(await save(a, "[1,2,3]"), "an array instead of an object");
  refused(await save(a, "null"), "null");
  refused(await save(a, JSON.stringify({ title: "t", rounds: "nope", settings: {} })), "rounds that are not a list");
  const huge = await save(a, JSON.stringify({ ...trivia(), pad: "x".repeat(300 * 1024) }));
  assert.equal(huge.statusCode, 413, "a body over 256 KB is refused outright");
  refused(await app.inject({ method: "POST", url: "/api/trivias/not-a-uuid/duplicate", headers: bare(a) as any }), "a malformed id");
  refused(await app.inject({ method: "GET", url: "/api/trivias/not-a-uuid", headers: a as any }), "a malformed id on read");
  await app.close();
});

test("a session holds at most 100 players, with sane names and PINs", () => {
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse(trivia().rounds), code: "ABCDE", maxGuesses: 3 });
  for (let i = 0; i < 100; i++) joinPlayer(g, `Team ${i}`);
  assert.throws(() => joinPlayer(g, "One too many"), /full/);
  assert.equal(g.players.length, 100);
  const h = newGame({ hostEmail: "h@example.com", triviaId: "t", title: "T", rounds: roundsSchema.parse(trivia().rounds), code: "ABCDF", maxGuesses: 3 });
  joinPlayer(h, "x".repeat(24));
  assert.throws(() => joinPlayer(h, "x".repeat(25)), /1-24/);
  assert.throws(() => joinPlayer(h, ""), /1-24/);
  assert.throws(() => joinPlayer(h, "   "), /1-24/);
  assert.equal(joinPlayer(h, "A\nB").player.nickname, "A B", "line breaks become a space, they are not kept");
  for (const bad of ["<b>hi</b>", "a\u0000b", "💥💥", "a/b", "a;b"]) assert.throws(() => joinPlayer(h, bad), /1-24/, `"${JSON.stringify(bad)}" is not a valid name`);
  for (const pin of ["12345", "123", "abcd", "12 4", "1.23", "-123"]) assert.throws(() => joinPlayer(h, "Pat", pin), /PIN/, `${pin} is not a valid PIN`);
  joinPlayer(h, "Pat", "0042");
});

test("answers: text is capped at 200 characters and numbers stay inside a range arithmetic can handle", async () => {
  const { app, as, save } = await setup();
  const a = await as("a@example.com");
  const t = await save(a, { ...trivia([q(), { type: "numeric_closest", config: { question: "n", value: 5 } }]), settings: { maxGuesses: 0, timeLimit: 0 } });
  const tid = t.json().id;
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: bare(a) as any })).json();
  const act = (x: object) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: a as any, payload: JSON.stringify(x) });
  const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL, "content-type": "application/json" }, payload: JSON.stringify({ code, nickname: "Ann" }) });
  const p = { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL, "content-type": "application/json" };
  const say = (v: string) => app.inject({ method: "POST", url: "/api/play/answer", headers: p, payload: `{"value":${v}}` });
  await act({ action: "begin" });
  assert.equal((await say(JSON.stringify({ text: "x".repeat(200) }))).statusCode, 200, "200 characters is fine");
  refused(await say(JSON.stringify({ text: "x".repeat(201) })), "201 characters");
  refused(await say(JSON.stringify({ text: "" })), "an empty answer");
  await act({ action: "close" }); await act({ action: "reveal" }); await act({ action: "next" });
  for (const v of ["1e15", "-1e15", "0", "-0.5", "123456.789"]) assert.equal((await say(`{"n":0,"value":${v}}`.replace('"n":0,', ""))).statusCode, 200, `${v} is a fine number`);
  for (const v of ["1e16", "-1e16", "1e300", "1e999", "-1e999", "123456789012345678901234567890"]) refused(await say(`{"value":${v}}`), `the number ${v}`);
  await app.close();
});

test("a host cannot pile up sessions or trivias without limit", async () => {
  const { app, as, save } = await setup();
  const a = await as("a@example.com");
  const tid = (await save(a, trivia())).json().id;
  const start = () => app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: bare(a) as any });
  for (let i = 0; i < 5; i++) assert.equal((await start()).statusCode, 201);
  assert.equal((await start()).statusCode, 429, "a sixth active session is refused");

  const { app: app2, as: as2, save: save2 } = await setup();
  const b = await as2("a@example.com");
  let made = 1;
  const first = (await save2(b, trivia())).json().id;
  for (; made < 100; made++) assert.equal((await save2(b, trivia())).statusCode, 201, `trivia ${made + 1} saves`);
  assert.equal((await save2(b, trivia())).statusCode, 429, "the 101st trivia is refused");
  assert.equal((await app2.inject({ method: "POST", url: `/api/trivias/${first}/duplicate`, headers: bare(b) as any })).statusCode, 429, "so is duplicating one");
  await app.close(); await app2.close();
});

test("extra time can be added only in steps up to 10 minutes, and never past 30 minutes from now", async () => {
  const { app, as, save } = await setup();
  const a = await as("a@example.com");
  const tid = (await save(a, { ...trivia(), settings: { maxGuesses: 3, timeLimit: 60 } })).json().id;
  const { id } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: bare(a) as any })).json();
  const act = (x: object) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: a as any, payload: JSON.stringify(x) });
  await act({ action: "begin" });
  for (const seconds of [0, 4, 601, 1e6, -30, 2.5, "30"]) refused(await act({ action: "extend", seconds }), `adding ${JSON.stringify(seconds)} seconds`);
  for (let i = 0; i < 12; i++) await act({ action: "extend", seconds: 600 });
  const left = (await app.inject({ url: `/api/sessions/${id}`, headers: a as any })).json().timer.deadline - Date.now();
  assert.ok(left <= 30 * 60 * 1000 + 1000, `never more than 30 minutes on the clock (it has ${Math.round(left / 60000)})`);
  assert.ok(left > 29 * 60 * 1000, "but it did take the extra time up to that limit");
  await app.close();
});

test("a host's manual award cannot be a typo: it is limited to what the question could plausibly be worth", async () => {
  const { app, as, save } = await setup();
  const a = await as("a@example.com");
  const tid = (await save(a, { ...trivia([q({ points: 4 }), { type: "wager", config: { question: "w", answers: ["a"], maxWager: 20 } }]), settings: { maxGuesses: 3, timeLimit: 0, theme: { secret: "s", hint: "", formal: "", bonus: 4 } } })).json().id;
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: bare(a) as any })).json();
  const act = (x: object) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: a as any, payload: JSON.stringify(x) });
  const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL, "content-type": "application/json" }, payload: JSON.stringify({ code, nickname: "Ann" }) });
  const p = { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL, "content-type": "application/json" };
  await act({ action: "begin" });
  await app.inject({ method: "POST", url: "/api/play/answer", headers: p, payload: JSON.stringify({ value: { text: "a" } }) });
  await app.inject({ method: "POST", url: "/api/play/theme", headers: p, payload: JSON.stringify({ guess: "idea" }) });
  await act({ action: "close" });
  const view = async () => (await app.inject({ url: `/api/sessions/${id}`, headers: a as any })).json();
  const answer = (await view()).answers[0];
  const guess = (await view()).theme.guesses[0];
  for (const points of [10, 4, 0.5, 0, -4]) assert.equal((await act({ action: "review", answerId: answer.id, points })).statusCode, 200, `${points} is a sensible award for a 4-point question`);
  for (const points of [10.5, 11, 100, 1000, -11]) {
    const r = await act({ action: "review", answerId: answer.id, points });
    assert.equal(r.statusCode, 409, `${points} on a 4-point question is refused`);
    assert.match(r.json().error, /most/, "and the host is told the limit");
  }
  // The over-limit attempt comes first: approving the only guess ends the theme, which would make a later refusal prove nothing.
  const tooBig = await act({ action: "theme_review", guessId: guess.id, points: 11 });
  assert.equal(tooBig.statusCode, 409, "a theme bonus of 11 is refused when the bonus is 4");
  assert.match(tooBig.json().error, /most is 10/, "and the host is told why");
  assert.equal((await act({ action: "theme_review", guessId: guess.id, points: 10 })).statusCode, 200, "10 is allowed");
  await app.close();
});
