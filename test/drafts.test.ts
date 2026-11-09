import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com", "b@example.com"] });
const trivia = { title: "Saved", settings: { maxGuesses: 3, timeLimit: 180 }, rounds: [{ title: "Round 1", modules: [] }] };
const draftState = JSON.stringify({ title: "Half-finished, not valid yet", settings: { maxGuesses: "", timeLimit: 180 }, rounds: [{ title: "", modules: [] }] });

async function setup() {
  const db = openDb(":memory:");
  const app = await buildApp(cfg, db, hosts);
  const as = async (email: string) => ({ cookie: "trivia_session=" + (await signSession(cfg, { email, name: email })), origin: cfg.BASE_URL });
  const id = (await app.inject({ method: "POST", url: "/api/trivias", headers: await as("a@example.com") as any, payload: trivia })).json().id as string;
  const call = (h: object, method: string, url: string, payload?: object) => app.inject({ method: method as any, url, headers: h as any, payload });
  return { app, db, as, id, call };
}

test("a draft is stored apart from the trivia, which stays exactly as saved", async () => {
  const { as, id, call } = await setup(); const a = await as("a@example.com");
  assert.equal((await call(a, "GET", `/api/trivias/${id}/draft`)).json().draft, null);
  assert.equal((await call(a, "PUT", `/api/trivias/${id}/draft`, { state: draftState })).statusCode, 200);
  const d = (await call(a, "GET", `/api/trivias/${id}/draft`)).json().draft;
  assert.equal(d.state, draftState);
  assert.equal((await call(a, "GET", `/api/trivias/${id}`)).json().title, "Saved");
});

test("the list marks a trivia with a draft, until the trivia is saved", async () => {
  const { as, id, call } = await setup(); const a = await as("a@example.com");
  assert.equal((await call(a, "GET", "/api/trivias")).json()[0].has_draft, false);
  await call(a, "PUT", `/api/trivias/${id}/draft`, { state: draftState });
  assert.equal((await call(a, "GET", "/api/trivias")).json()[0].has_draft, true);
  await call(a, "PUT", `/api/trivias/${id}`, trivia); // a real save clears it
  assert.equal((await call(a, "GET", "/api/trivias")).json()[0].has_draft, false);
  assert.equal((await call(a, "GET", `/api/trivias/${id}/draft`)).json().draft, null);
});

test("a draft older than the saved trivia is not offered", async () => {
  const { as, id, call, db } = await setup(); const a = await as("a@example.com");
  await call(a, "PUT", `/api/trivias/${id}/draft`, { state: draftState });
  db.prepare("UPDATE trivias SET updated_at = ? WHERE id = ?").run(Date.now() + 60_000, id);
  assert.equal((await call(a, "GET", `/api/trivias/${id}/draft`)).json().draft, null);
  assert.equal((await call(a, "GET", "/api/trivias")).json()[0].has_draft, false);
});

test("drafts are private: other hosts cannot read, write or see them; an admin has their own", async () => {
  const { as, id, call } = await setup(); const a = await as("a@example.com"), b = await as("b@example.com"), o = await as("owner@example.com");
  await call(a, "PUT", `/api/trivias/${id}/draft`, { state: draftState });
  assert.equal((await call(b, "GET", `/api/trivias/${id}/draft`)).statusCode, 404);
  assert.equal((await call(b, "PUT", `/api/trivias/${id}/draft`, { state: draftState })).statusCode, 404);
  assert.equal((await call(b, "DELETE", `/api/trivias/${id}/draft`)).statusCode, 404);
  assert.equal((await call(o, "GET", `/api/trivias/${id}/draft`)).json().draft, null, "admin does not see the owner's draft");
  assert.equal((await call(o, "GET", "/api/trivias?all=1")).json()[0].has_draft, false);
  assert.equal((await call({}, "GET", `/api/trivias/${id}/draft`)).statusCode, 401);
});

test("bad drafts are refused: not JSON, not an object, over 1 million characters", async () => {
  const { as, id, call } = await setup(); const a = await as("a@example.com");
  for (const state of ["nope", "[1]", "42", "x".repeat(1_000_001)]) assert.equal((await call(a, "PUT", `/api/trivias/${id}/draft`, { state })).statusCode, 400, state.slice(0, 10));
  assert.equal((await call(a, "PUT", `/api/trivias/${id}/draft`, { other: 1 })).statusCode, 400);
});

test("deleting a draft, and deleting the trivia, both remove it", async () => {
  const { as, id, call, db } = await setup(); const a = await as("a@example.com");
  await call(a, "PUT", `/api/trivias/${id}/draft`, { state: draftState });
  await call(a, "DELETE", `/api/trivias/${id}/draft`);
  assert.equal((await call(a, "GET", `/api/trivias/${id}/draft`)).json().draft, null);
  await call(a, "PUT", `/api/trivias/${id}/draft`, { state: draftState });
  await call(a, "DELETE", `/api/trivias/${id}`);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM drafts").get() as any).n, 0);
});

test("a big draft is kept in full, even one larger than a trivia could be saved", async () => {
  const { as, id, call } = await setup(); const a = await as("a@example.com");
  const big = JSON.stringify({ title: "t", settings: {}, rounds: [], pad: "é\"\\".repeat(150_000) }); // ~0.9M chars, and quoting nearly doubles it on the wire
  assert.ok(big.length > 256 * 1024 && big.length < 1_000_000);
  assert.equal((await call(a, "PUT", `/api/trivias/${id}/draft`, { state: big })).statusCode, 200);
  assert.equal((await call(a, "GET", `/api/trivias/${id}/draft`)).json().draft.state, big);
});

test("the trivia carries its save time, so the builder can tell a draft is out of date", async () => {
  const { as, id, call, db } = await setup(); const a = await as("a@example.com");
  const before = (await call(a, "GET", `/api/trivias/${id}`)).json().updated_at;
  assert.equal(typeof before, "number");
  await new Promise((r) => setTimeout(r, 5));
  await call(a, "PUT", `/api/trivias/${id}`, trivia);
  assert.ok((await call(a, "GET", `/api/trivias/${id}`)).json().updated_at > before);
});
