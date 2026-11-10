import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false", LOG_LEVEL: "silent" });
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com"] });
const qa = (question: string, answers: string[]) => ({ type: "text_qa", config: { question, answers } });
const ok = { title: "Night", settings: { maxGuesses: 3, timeLimit: 180 } };

async function setup() {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const headers = { cookie: "trivia_session=" + (await signSession(cfg, { email: "a@example.com", name: "a" })), origin: cfg.BASE_URL };
  const save = (payload: object) => app.inject({ method: "POST", url: "/api/trivias", headers: headers as any, payload });
  return { app, save };
}

test("an empty question is reported once, in plain words, with where it is", async () => {
  const { app, save } = await setup();
  // The case that tripped a host up: a blank Final Jeopardy added by accident at the end of round two.
  const r = await save({ ...ok, rounds: [{ title: "Round 1", modules: [qa("q", ["a"])] }, { title: "Round 2", modules: [qa("q", ["a"]), { type: "jeopardy", config: { category: "", question: "", answers: [], maxWager: 20 } }] }] });
  assert.equal(r.statusCode, 400);
  const j = r.json();
  assert.equal(j.problems.length, 1, "one problem, not one per empty box");
  assert.deepEqual([j.problems[0].round, j.problems[0].question], [1, 1]);
  assert.match(j.problems[0].message, /^Round 2, question 2 \(Final Jeopardy\): this question is empty\. Fill it in, or remove it/);
  assert.match(j.error, /question 2 \(Final Jeopardy\)/, "the message the page shows names the question");
  assert.ok(!/too_small|origin|inclusive|\[\s*\{/.test(j.error), "no raw validation output");
  await app.close();
});

test("a half-filled question names the box that is wrong", async () => {
  const { app, save } = await setup();
  const r = await save({ ...ok, rounds: [{ title: "Warm-up", modules: [qa("A real question?", []), qa("", ["x"]), { type: "multiple_choice", config: { question: "q", options: ["only one"], correct: 0 } }] }] });
  const m = r.json().problems.map((p: any) => p.message);
  assert.deepEqual(m, [
    'Warm-up, question 1 (Question and answer): "Answer" needs at least one entry.',
    'Warm-up, question 2 (Question and answer): "Question" is empty.',
    'Warm-up, question 3 (Multiple choice): "Options" needs at least 2 entries.',
  ]);
  assert.deepEqual(r.json().problems.map((p: any) => p.field), ["answers", "question", "options"]);
  await app.close();
});

test("trivia and round level mistakes are explained too", async () => {
  const { app, save } = await setup();
  const r = await save({ title: "", settings: { maxGuesses: 3, timeLimit: 180 }, rounds: [{ title: "", modules: [qa("q", ["a"])] }] });
  const m = r.json().problems.map((p: any) => p.message);
  assert.ok(m.includes("The trivia title is empty."), m.join(" | "));
  assert.ok(m.includes("Round 1 needs a title."), m.join(" | "));
  const long = await save({ ...ok, rounds: [{ title: "R", modules: [{ ...qa("q", ["a"]), section: "x".repeat(61) }] }] });
  assert.match(long.json().problems[0].message, /"Section name" is too long \(60 characters at most\)\./);
  await app.close();
});

test("a valid trivia still saves, and an unknown question type is named", async () => {
  const { app, save } = await setup();
  assert.equal((await save({ ...ok, rounds: [{ title: "R", modules: [qa("q", ["a"])] }] })).statusCode, 201);
  const bad = await save({ ...ok, rounds: [{ title: "R", modules: [{ type: "nope", config: {} }] }] });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().problems[0].message, /unknown question type: nope/);
  await app.close();
});
