import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession, verifySession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

const env = {
  BASE_URL: "https://trivia.example.com",
  SESSION_SECRET: "x".repeat(40),
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
};
const cfg = loadConfig(env);
const hosts = HostDirectory.fromLists({ admins: ["Owner@Example.com"], hosts: ["host@example.com", "other@example.com"] });

test("roles are case-insensitive and exact", () => {
  assert.equal(hosts.roleOf("owner@example.com"), "admin");
  assert.equal(hosts.roleOf("HOST@example.com"), "host");
  assert.equal(hosts.roleOf("evil@example.com"), null);
  assert.equal(hosts.roleOf("host@example.com.evil.io"), null);
});

test("session verifies, but a tampered token, removed host or other secret does not", async () => {
  const t = await signSession(cfg, { email: "host@example.com", name: "H" });
  assert.equal((await verifySession(cfg, hosts, t))?.role, "host");
  assert.equal(await verifySession(cfg, hosts, t + "x"), null);
  assert.equal(await verifySession(cfg, HostDirectory.fromLists({ admins: ["owner@example.com"] }), t), null);
  assert.equal(await verifySession(loadConfig({ ...env, SESSION_SECRET: "y".repeat(40) }), hosts, t), null);
});

test("hosts file hot-reloads and survives a bad edit", async () => {
  const { mkdtempSync, writeFileSync, utimesSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const f = join(mkdtempSync(join(tmpdir(), "hosts-")), "hosts.json");
  writeFileSync(f, JSON.stringify({ admins: ["a@x.com"], hosts: [] }));
  const dir = HostDirectory.fromFile(f);
  assert.equal(dir.roleOf("b@x.com"), null);
  writeFileSync(f, JSON.stringify({ admins: ["a@x.com"], hosts: ["b@x.com"] }));
  utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.equal(dir.roleOf("b@x.com"), "host");
  writeFileSync(f, "{ not json");
  utimesSync(f, new Date(), new Date(Date.now() + 10000));
  assert.equal(dir.roleOf("b@x.com"), "host");
});

const trivia = { title: "t", rounds: [{ title: "r", modules: [
  { type: "text_qa", config: { question: "q1", answers: ["a"] } },
  { type: "theme_guess", config: { theme: "space", hint: "up" } },
] }] };

async function setup() {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const cookie = async (email: string) => `trivia_session=${await signSession(cfg, { email, name: email })}`;
  const as = async (email: string) => ({ cookie: await cookie(email), origin: cfg.BASE_URL });
  return { app, as };
}

test("API requires login, enforces origin, and isolates hosts but not admins", async () => {
  const { app, as } = await setup();
  assert.equal((await app.inject("/api/trivias")).statusCode, 401);
  const alice = await as("host@example.com");
  const bob = await as("other@example.com");
  const owner = await as("owner@example.com");

  assert.equal((await app.inject({ method: "POST", url: "/api/trivias", headers: { cookie: alice.cookie }, payload: trivia })).statusCode, 403);
  const { id } = (await app.inject({ method: "POST", url: "/api/trivias", headers: alice, payload: trivia })).json();

  assert.equal((await app.inject({ url: `/api/trivias/${id}`, headers: alice })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/trivias/${id}`, headers: bob })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/trivias/${id}`, headers: owner })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/admin/overview", headers: alice })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/admin/overview", headers: owner })).statusCode, 200);
  const bad = await app.inject({ method: "POST", url: "/api/trivias", headers: alice, payload: { title: "t", rounds: [{ title: "r", modules: [{ type: "evil", config: {} }] }] } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test("full live session: join, answer, host control, admin override, answers never leak", async () => {
  const { app, as } = await setup();
  const alice = await as("host@example.com");
  const bob = await as("other@example.com");
  const owner = await as("owner@example.com");
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: alice, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: alice })).json();
  const act = (headers: any, body: any) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers, payload: body });

  const join = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code: code.toLowerCase(), nickname: "Zed" } });
  assert.equal(join.statusCode, 200);
  const pc = String(join.headers["set-cookie"]).split(";")[0]!;
  const player = { cookie: pc, origin: cfg.BASE_URL };
  assert.equal((await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "zed" } })).statusCode, 409);

  assert.equal((await act(alice, { action: "begin" })).statusCode, 200);
  const state = (await app.inject({ url: "/api/play/state", headers: player })).json();
  assert.equal(state.phase, "open");
  assert.ok(!JSON.stringify(state).includes('"a"'), "solution must not be sent while open");
  assert.equal(state.item.solution, undefined);

  assert.equal((await app.inject({ method: "POST", url: "/api/play/answer", headers: player, payload: { value: { text: "A" } } })).statusCode, 200);
  assert.equal((await act(bob, { action: "reveal" })).statusCode, 404, "another host cannot control it");
  assert.equal((await act(owner, { action: "reveal" })).statusCode, 200, "admin can");
  const revealed = (await app.inject({ url: "/api/play/state", headers: player })).json();
  assert.equal(revealed.item.solution, "a");
  assert.equal(revealed.leaderboard[0].points, 1);

  // BUG-001: theme guesses are scoped to the item, capped, and gone after moving on.
  assert.equal((await act(alice, { action: "next" })).statusCode, 200);
  for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: "POST", url: "/api/play/answer", headers: player, payload: { value: { guess: `g${i}` } } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/play/answer", headers: player, payload: { value: { guess: "g6" } } })).statusCode, 429);
  assert.equal((await app.inject({ url: "/api/play/state", headers: player })).json().myAnswers.length, 5);
  assert.equal((await act(alice, { action: "next" })).statusCode, 200);
  const done = (await app.inject({ url: "/api/play/state", headers: player })).json();
  assert.equal(done.phase, "ended");
  assert.equal(done.myAnswers.length, 0);

  const audit = (await app.inject({ url: "/api/admin/overview", headers: owner })).json().audit;
  assert.ok(audit.some((a: any) => a.action === "session.reveal" && a.actor === "owner@example.com"));
  await app.close();
});

test("kicked players are locked out", async () => {
  const { app, as } = await setup();
  const alice = await as("host@example.com");
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: alice, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: alice })).json();
  const join = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "Pat" } });
  const player = { cookie: String(join.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL };
  const pid = (await app.inject({ url: `/api/sessions/${id}`, headers: alice })).json().playerList[0].id;
  await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: alice, payload: { action: "kick", playerId: pid } });
  assert.equal((await app.inject({ url: "/api/play/state", headers: player })).statusCode, 401);
  await app.close();
});
