import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { JOIN_FAILURES_PER_MINUTE } from "../src/play.js";

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const hosts = HostDirectory.fromLists({ admins: ["o@example.com"] });
const trivia = (answers: string[] = ["Nepal"]) => ({ title: "t", settings: { maxGuesses: 3 }, rounds: [{ title: "R", modules: [{ type: "text_qa", config: { question: "Which country?", answers } }] }] });

async function setup() {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const host = { cookie: "trivia_session=" + (await signSession(cfg, { email: "o@example.com", name: "O" })), origin: cfg.BASE_URL };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia() })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: host })).json();
  const join = (nickname: string, c = code, pin?: string) => app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, remoteAddress: "10.0.0.5", payload: { code: c, nickname, pin } });
  return { app, host, id, code, join };
}

test("a whole room can join from one address: only refused attempts are counted tightly", async () => {
  const { join } = await setup();
  for (let i = 0; i < 100; i++) assert.equal((await join(`Team ${i}`)).statusCode, 200, `team ${i} gets in`);
});

test("guessing room codes from one address is cut off, and arrivals before it do not use up the allowance", async () => {
  const { join } = await setup();
  for (let i = 0; i < 40; i++) assert.equal((await join(`Early ${i}`)).statusCode, 200);
  for (let i = 0; i < JOIN_FAILURES_PER_MINUTE; i++) assert.equal((await join("Guesser", "ZZZZZ")).statusCode, 404);
  const blocked = await join("Guesser", "ZZZZZ");
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.json().error, /too many failed attempts/);
  assert.equal((await join("Another")).statusCode, 429, "that address waits, whatever it tries next");
});

test("wrong PINs and taken names count as refused attempts; a typo in a name does not", async () => {
  const { join } = await setup();
  assert.equal((await join("Rockets", undefined, "1234")).statusCode, 200);
  for (let i = 0; i < 40; i++) assert.equal((await join("bad name!!")).statusCode, 400, "a typo is not guessing");
  assert.equal((await join("Fine")).statusCode, 200, "typos did not use the allowance");
  for (let i = 0; i < JOIN_FAILURES_PER_MINUTE; i++) assert.ok([409, 429].includes((await join("Rockets", undefined, "0000")).statusCode), `wrong PIN ${i} is refused`);
  assert.equal((await join("Other")).statusCode, 429);
});

test("a blank or punctuation-only answer is refused and does not use a guess", async () => {
  const { app, host, id, code, join } = await setup();
  const j = await join("Rockets");
  const phone = { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL };
  await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: { action: "begin" } });
  const say = (text: string) => app.inject({ method: "POST", url: "/api/play/answer", headers: phone, payload: { value: { text } } });
  for (const t of ["   ", "!!!", "?", "...", " - ", "\t", "🎃"]) {
    const r = await say(t);
    assert.equal(r.statusCode, 400, JSON.stringify(t));
    assert.match(r.json().error, /at least one letter or number/);
  }
  const v = (await app.inject({ url: "/api/play/state", headers: phone })).json();
  assert.equal(v.guessesLeft, 3, "refused answers use no guess");
  assert.equal((await say("1")).statusCode, 200, "a number is an answer");
  assert.equal((await say("Nepal!")).statusCode, 200, "punctuation around real text is fine");
  assert.ok(code);
});

test("the builder refuses an accepted answer that is blank or only punctuation, and says where", async () => {
  const { app, host } = await setup();
  for (const bad of ["   ", "?!", "..."]) {
    const r = await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia(["Nepal", bad]) });
    assert.equal(r.statusCode, 400, JSON.stringify(bad));
    const p = r.json().problems[0];
    assert.equal(p.round, 0);
    assert.equal(p.question, 0);
    assert.equal(p.field, "answers");
    assert.match(p.message, /R, question 1/);
    assert.match(p.message, /at least one letter or number/);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia(["42", "Nepal"]) })).statusCode, 201, "numbers are fine as answers");
});
