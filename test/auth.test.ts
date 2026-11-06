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

test("gmail dots, +tags and googlemail.com map to the same host; other domains stay exact", () => {
  const d = HostDirectory.fromLists({ hosts: ["jane.doe@gmail.com", "a.b@corp.com"] });
  for (const e of ["janedoe@gmail.com", "Jane.Doe+x@gmail.com", "janedoe@googlemail.com"]) assert.equal(d.roleOf(e), "host");
  assert.equal(d.roleOf("ab@corp.com"), null);
  assert.equal(d.roleOf("janedoe@gmail.com.evil.io"), null);
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

const q = (question: string, answers: string[], extra: object = {}) => ({ type: "text_qa", config: { question, answers, ...extra } });
const trivia = {
  title: "t",
  settings: { maxGuesses: 3, theme: { secret: "space", hint: "look up", formal: "Everything was about space" } },
  rounds: [
    { title: "R1", modules: [q("q1", ["a"], { funFact: "because" }), q("q2", ["b"])] },
    { title: "R2", modules: [q("q3", ["c"])] },
  ],
};

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

test("full live session over HTTP: join, rejoin by PIN, round-end boards, theme, admin override, no leaks", async () => {
  const { app, as } = await setup();
  const alice = await as("host@example.com");
  const bob = await as("other@example.com");
  const owner = await as("owner@example.com");
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: alice, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: alice })).json();
  const act = (headers: any, body: any) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers, payload: body });
  const open = { origin: cfg.BASE_URL };
  const join = (nickname: string, pin?: string) => app.inject({ method: "POST", url: "/api/join", headers: open, payload: { code: code.toLowerCase(), nickname, pin } });

  const j = await join("Zed", "1234");
  assert.equal(j.statusCode, 200);
  assert.equal((await join("zed")).statusCode, 409, "name taken without the PIN");
  assert.equal((await join("zed", "9999")).statusCode, 409, "wrong PIN");
  const again = await join("ZED", "1234");
  assert.equal(again.statusCode, 200, "right PIN gets the same player back");
  const player = { cookie: String(again.headers["set-cookie"]).split(";")[0]!, ...open };
  const state = async () => (await app.inject({ url: "/api/play/state", headers: player })).json();
  const say = (text: string) => app.inject({ method: "POST", url: "/api/play/answer", headers: player, payload: { value: { text } } });
  assert.equal((await state()).players, 1, "rejoining did not create a second player");

  assert.equal((await act(alice, { action: "begin" })).statusCode, 200);
  const s1 = await state();
  assert.equal(s1.item.public.question, "q1");
  assert.deepEqual(s1.item.pos, { n: 1, of: 2 }, "numbering counts questions in the same run");
  assert.equal(s1.item.public.clue1, undefined, "there are no separate clue boxes");
  assert.equal(s1.item.solution, undefined, "no solution while open");
  assert.equal(s1.item.funFact, undefined);
  assert.ok(!JSON.stringify(s1).includes('"because"'), "fun fact stays hidden until reveal");
  assert.equal(s1.theme.hint, "look up");
  assert.equal(s1.theme.secret, undefined);

  assert.equal((await say("A")).statusCode, 200);
  assert.equal((await act(bob, { action: "reveal" })).statusCode, 404, "another host cannot control it");
  assert.equal((await act(owner, { action: "reveal" })).statusCode, 200, "admin can");
  const r1 = await state();
  assert.equal(r1.item.solution, "a");
  assert.equal(r1.item.funFact, "because");
  assert.equal(r1.leaderboard, null, "no board mid-round");

  // BUG-001: answers are per question, capped, and gone after moving on.
  await act(alice, { action: "next" });
  for (const t of ["x1", "x2", "x3"]) assert.equal((await say(t)).statusCode, 200);
  assert.equal((await say("x4")).statusCode, 429);
  assert.equal((await state()).myAnswers.length, 1);

  // Secret theme: guesses are capped, hidden, and only count once revealed.
  for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: "POST", url: "/api/play/theme", headers: player, payload: { guess: `moon${i}` } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/play/theme", headers: player, payload: { guess: "sun" } })).statusCode, 429);
  const hv = (await app.inject({ url: `/api/sessions/${id}`, headers: alice })).json();
  assert.equal(hv.theme.guesses.length, 5);
  assert.equal(hv.theme.guesses[0].suggested, 3, "guess made at question 2 suggests 3 points");
  assert.equal((await act(alice, { action: "theme_review", guessId: hv.theme.guesses[0].id, points: 3 })).statusCode, 200);
  assert.equal(JSON.stringify(await state()).includes("approved"), false, "players are never shown an approval status");

  await act(alice, { action: "reveal" });
  const r2 = await state();
  assert.equal(r2.theme.secret, "space", "approving the only player's guess means everyone found it, so it is out");
  assert.equal(r2.leaderboard[0].points, 4, "round-end board: 1 for q1 plus the 3 theme bonus");

  await act(alice, { action: "next" });
  const round2 = await state();
  assert.equal(round2.theme.secret, "space", "the theme goes public when round two begins");
  assert.deepEqual(round2.item.pos, { n: 1, of: 1 });
  await act(alice, { action: "next" });
  const done = await state();
  assert.equal(done.phase, "ended");
  assert.equal(done.myAnswers.length, 0);
  assert.equal(done.theme.secret, "space");
  assert.equal(done.theme.formal, "Everything was about space");
  assert.equal(done.leaderboard[0].points, 4, "1 for q1 + 3 theme bonus, counted once revealed");

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

test("rate limits: static files are exempt, players are counted per cookie, joining stays per IP", async () => {
  const { app } = await setup();
  const origin = { origin: cfg.BASE_URL };
  for (let i = 0; i < 400; i++) assert.equal((await app.inject("/styles.css")).statusCode, 200);

  // Two phones behind one IP each get their own allowance on player endpoints.
  const codes: number[] = [];
  for (let i = 0; i < 400; i++) codes.push((await app.inject({ url: "/api/play/state", headers: { cookie: `trivia_player=phone${i % 2}` }, remoteAddress: "10.0.0.9" })).statusCode);
  assert.ok(!codes.includes(429), "two phones on one IP are not throttled together");

  // Joining is the guessing target: changing the cookie must not reset its per-IP limit.
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    const r = await app.inject({ method: "POST", url: "/api/join", headers: { ...origin, cookie: `trivia_player=x${i}` }, payload: { code: "ZZZZZ", nickname: "a" }, remoteAddress: "10.0.0.7" });
    if (r.statusCode === 429) blocked = true;
  }
  assert.ok(blocked, "join attempts are limited per IP regardless of cookie");
  await app.close();
});

test("config: listen address defaults to all interfaces and can be pinned; hosts can be inline JSON", () => {
  assert.equal(loadConfig(env).HOST, "0.0.0.0");
  assert.equal(loadConfig({ ...env, HOST: "127.0.0.1" }).HOST, "127.0.0.1");
  const inline = HostDirectory.fromLists(JSON.parse(loadConfig({ ...env, HOSTS_JSON: '{"admins":["a@x.com"],"hosts":["b@x.com"]}' }).HOSTS_JSON!));
  assert.equal(inline.roleOf("A@x.com"), "admin");
  assert.equal(inline.roleOf("b@x.com"), "host");
});
