import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com", "b@example.com"] });
const original = {
  title: "Tuesday night",
  settings: { maxGuesses: 2, timeLimit: 90, theme: { secret: "space", hint: "up", formal: "all space", bonus: 5 } },
  rounds: [
    { title: "Round 1", modules: [{ type: "text_qa", section: "Hodgepodge", timeLimit: 30, config: { question: "Which?", answers: ["Nepal"], funFact: "because" } }] },
    { title: "Round 2", modules: [{ type: "wager", config: { question: "Final?", answers: ["Taft"], maxWager: 20 } }] },
  ],
};

async function setup() {
  const db = openDb(":memory:");
  const app = await buildApp(cfg, db, hosts);
  const as = async (email: string) => ({ cookie: "trivia_session=" + (await signSession(cfg, { email, name: email })), origin: cfg.BASE_URL });
  const create = async (h: object, body: object = original) => (await app.inject({ method: "POST", url: "/api/trivias", headers: h as any, payload: body })).json().id as string;
  const get = async (h: object, id: string) => app.inject({ url: `/api/trivias/${id}`, headers: h as any });
  const dup = (h: object, id: string) => app.inject({ method: "POST", url: `/api/trivias/${id}/duplicate`, headers: h as any });
  return { app, db, as, create, get, dup };
}

test("duplicating makes an independent private copy with everything in it", async () => {
  const { app, as, create, get, dup } = await setup();
  const a = await as("a@example.com");
  const id = await create(a);
  const r = await dup(a, id);
  assert.equal(r.statusCode, 201);
  const copy = r.json();
  assert.notEqual(copy.id, id);
  assert.equal(copy.title, "Tuesday night (copy)");

  const o = (await get(a, id)).json(), c = (await get(a, copy.id)).json();
  assert.deepEqual(c.rounds, o.rounds, "same rounds, questions, sections and per-question settings");
  assert.deepEqual(c.settings, o.settings, "same guess limit, time limit and secret theme");
  assert.equal(c.owner, "a@example.com");

  // Editing the copy leaves the original alone.
  const edited = { ...original, title: "Friday night", rounds: [original.rounds[0]] };
  assert.equal((await app.inject({ method: "PUT", url: `/api/trivias/${copy.id}`, headers: a, payload: edited })).statusCode, 200);
  const after = (await get(a, id)).json();
  assert.equal(after.title, "Tuesday night");
  assert.equal(after.rounds.length, 2, "the original still has both rounds");
  const list = (await app.inject({ url: "/api/trivias", headers: a })).json();
  assert.deepEqual(list.map((t: any) => t.title).sort(), ["Friday night", "Tuesday night"]);
  await app.close();
});

test("only the owner (or an admin) can copy a trivia, and an admin's copy becomes their own", async () => {
  const { app, as, create, get, dup } = await setup();
  const a = await as("a@example.com"), b = await as("b@example.com"), owner = await as("owner@example.com");
  const id = await create(a);
  assert.equal((await dup(b, id)).statusCode, 404, "another host cannot see it, let alone copy it");
  assert.equal((await dup({ origin: cfg.BASE_URL }, id)).statusCode, 401, "logged-out visitors cannot");
  const r = await dup(owner, id);
  assert.equal(r.statusCode, 201);
  const copy = (await get(owner, r.json().id)).json();
  assert.equal(copy.owner, "owner@example.com", "the copy belongs to the admin who made it");
  assert.equal((await get(a, r.json().id)).statusCode, 404, "and the original owner cannot see the admin's copy");
  assert.equal((await get(a, id)).json().owner, "a@example.com", "the original is unchanged");
  const audit = (await app.inject({ url: "/api/admin/overview", headers: owner })).json().audit;
  assert.ok(audit.some((x: any) => x.action === "trivia.duplicate" && x.actor === "owner@example.com"), "copying someone else's trivia is logged");
  await app.close();
});

test("a very long title still fits after '(copy)' is added", async () => {
  const { app, as, create, dup } = await setup();
  const a = await as("a@example.com");
  const id = await create(a, { ...original, title: "x".repeat(120) });
  const r = await dup(a, id);
  assert.equal(r.statusCode, 201);
  assert.ok(r.json().title.length <= 120 && r.json().title.endsWith(" (copy)"));
  await app.close();
});

test("a trivia saved with the older clue boxes is copied in its cleaned-up form", async () => {
  const { app, db, as, get, dup } = await setup();
  const a = await as("a@example.com");
  const legacy = [{ title: "R", modules: [{ type: "text_qa", config: { clue1: "Its flag is no rectangle.", clue2: "Home to Everest.", question: "Which country?", answers: ["Nepal"], category: "Geo", tier: "Layup" } }] }];
  db.prepare("INSERT INTO trivias (id, host_email, title, rounds, created_at, updated_at, settings) VALUES (?, ?, ?, ?, 1, 1, '{}')").run("11111111-1111-4111-8111-111111111111", "a@example.com", "Old", JSON.stringify(legacy));
  const r = await dup(a, "11111111-1111-4111-8111-111111111111");
  const copy = (await get(a, r.json().id)).json();
  const q = copy.rounds[0].modules[0].config;
  assert.equal(q.question, "Its flag is no rectangle. Home to Everest.\n\nWhich country?");
  assert.equal("clue1" in q, false);
  assert.equal(copy.settings.timeLimit, 180, "settings missing from an old row fall back to the defaults");
  await app.close();
});
