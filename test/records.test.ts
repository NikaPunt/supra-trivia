import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb, SCHEMA_VERSION } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { GameStore } from "../src/store.js";
import { act, joinPlayer, newGame, playerView, deckView, submit, submitTheme, takeRecords } from "../src/game.js";
import { roundsSchema } from "../src/modules/index.js";

// What is kept for good: the record of each session (what every team answered) and the audit log (what hosts and admins did).

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false", LOG_LEVEL: "silent" });
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com", "b@example.com", "dotted.name@gmail.com"] });
const origin = { origin: cfg.BASE_URL };
const session = async (email: string) => ({ cookie: `trivia_session=${await signSession(cfg, { email, name: email })}`, ...origin });
const text = (question: string, answer: string) => ({ type: "text_qa", config: { question, answers: [answer] } });
const rounds = [
  { title: "R1", modules: [text("capital of France?", "Paris"), { type: "multiple_choice", config: { question: "pick", options: ["red", "green"], correct: 1 } }] },
  { title: "R2", modules: [{ type: "wager", config: { question: "final?", answers: ["yes"], maxWager: 5 } }] },
];

test("every finished question leaves a permanent record of what each team answered, outside the live state", () => {
  const db = openDb(":memory:");
  const store = new GameStore(db);
  const g = newGame({ hostEmail: "a@example.com", triviaId: "t", title: "night", rounds: roundsSchema.parse(rounds), code: store.newCode(), maxGuesses: 3, theme: { secret: "Colours", hint: "", formal: "", bonus: 4 } });
  const ann = joinPlayer(g, "Ann").player, bob = joinPlayer(g, "Bob").player;
  const step = (...as: string[]) => { for (const a of as) act(g, { action: a } as any); store.save(g); };
  step("begin");
  submit(g, ann.id, { text: "Lyon" });
  submit(g, ann.id, { text: "paris" });
  submit(g, bob.id, { text: "Rome" });
  submitTheme(g, bob.id, "colours");
  act(g, { action: "review", answerId: g.answers.find((a) => a.playerId === bob.id)!.id, points: 0.5 });
  step("close", "reveal", "next");
  submit(g, ann.id, { choice: 1 });
  step("close", "reveal", "next");
  submit(g, ann.id, { text: "yes", wager: 5 });
  submit(g, bob.id, { text: "no", wager: 2 });
  step("close", "reveal", "next");
  assert.equal(g.phase, "ended");

  const recs = store.records(g.id);
  assert.deepEqual(recs.map((r) => r.kind), ["question", "question", "theme", "question"]);
  const q1 = recs[0]!.data as any;
  assert.equal(q1.question, "capital of France?");
  assert.equal(q1.solution, "Paris");
  assert.deepEqual(q1.answers.map((a: any) => [a.team, a.answer, a.status, a.points, a.marked]), [["Ann", "paris", "approved", 1, false], ["Bob", "Rome", "approved", 0.5, true]]);
  assert.deepEqual(q1.guesses.map((x: any) => `${x.team}:${x.answer}`), ["Ann:Lyon", "Ann:paris", "Bob:Rome"], "replaced guesses are kept too");
  assert.equal((recs[1]!.data as any).answers[0].answer, "green", "a choice is recorded as its text");
  const theme = recs[2]!.data as any;
  assert.deepEqual(theme.guesses.map((x: any) => [x.team, x.guess, x.status, x.points]), [["Bob", "colours", "approved", 4]]);
  const q3 = recs[3]!.data as any;
  assert.deepEqual(q3.answers.map((a: any) => [a.answer, a.points]), [["yes (stake 5)", 5], ["no (stake 2)", -2]]);
  assert.deepEqual(q3.points, { Ann: 5, Bob: -2 });

  // None of it rides along in the live state or reaches a player or the projector.
  const stored = (db.prepare("SELECT state FROM games WHERE id = ?").get(g.id) as { state: string }).state;
  for (const leak of ["Lyon", "Rome", "solution"]) assert.ok(!stored.includes(leak), `${leak} is not in the saved state`);
  assert.ok(!JSON.stringify([playerView(g, ann.id), deckView(g)]).includes("Rome"));
  assert.deepEqual(takeRecords(g), [], "handed over once");
  store.close();

  // Deleting an old session (only when retention is switched on) takes its record with it and leaves a line in the audit log.
  db.prepare("UPDATE games SET updated_at = 1").run();
  const pruning = new GameStore(db, 30);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM game_records").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT action FROM audit").get() as { action: string }).action, "session.purged");
  pruning.close();
});

test("the record is for the owner and admins; hosts' and admins' actions are on the audit log with where they came from", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const a = await session("a@example.com"), b = await session("b@example.com"), owner = await session("owner@example.com");
  const post = (url: string, headers: object, payload?: object) => app.inject({ method: "POST", url, headers: headers as any, payload, remoteAddress: "203.0.113.7" });
  const tid = (await post("/api/trivias", a, { title: "=HYPERLINK(\"http://evil\")", settings: { maxGuesses: 3, timeLimit: 0 }, rounds })).json().id;
  const { id, code } = (await post(`/api/trivias/${tid}/sessions`, a)).json();
  const join = await post("/api/join", origin, { code, nickname: "Ann" });
  const player = { cookie: String(join.headers["set-cookie"]).split(";")[0]!, ...origin };
  await post(`/api/sessions/${id}/action`, a, { action: "begin" });
  await post("/api/play/answer", player, { value: { text: "Paris" } });
  const ans = (await app.inject({ url: `/api/sessions/${id}`, headers: a })).json().answers[0];
  await post(`/api/sessions/${id}/action`, a, { action: "review", answerId: ans.id, points: 1 });
  for (const action of ["close", "reveal", "next"]) await post(`/api/sessions/${id}/action`, a, { action });
  await post(`/api/sessions/${id}/action`, owner, { action: "end" });

  const mine = await app.inject({ url: `/api/sessions/${id}/record`, headers: a });
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.json().records[0].data.answers[0].answer, "Paris");
  assert.deepEqual(mine.json().leaderboard, [{ nickname: "Ann", points: 1 }]);
  assert.equal((await app.inject({ url: `/api/sessions/${id}/record`, headers: b })).statusCode, 404, "another host cannot read it");
  assert.equal((await app.inject({ url: `/api/sessions/${id}/record`, headers: player })).statusCode, 401, "nor can a player");
  assert.equal((await app.inject({ url: `/api/sessions/${id}/record`, headers: owner })).statusCode, 200);

  assert.equal((await app.inject({ url: "/api/admin/audit", headers: a })).statusCode, 403, "the audit log is for admins");
  const log = (await app.inject({ url: "/api/admin/audit?limit=500", headers: owner })).json().rows as any[];
  const did = log.map((r) => `${r.actor.split("@")[0]} ${r.action}`).reverse();
  assert.deepEqual(did, ["a trivia.create", "a session.create", "a session.begin", "owner session.end", "owner session.record_view"]);
  assert.ok(!did.some((x) => x.includes("review")), "marking answers is in the record, not the audit log");
  assert.equal(log.find((r) => r.action === "session.create").ip, "203.0.113.7");
  assert.equal(JSON.parse(log.find((r) => r.action === "session.end").detail).others, true, "an admin acting on someone else's session is flagged");

  // Paging and filtering.
  const page = (await app.inject({ url: "/api/admin/audit?limit=2", headers: owner })).json();
  assert.equal(page.rows.length, 2);
  assert.equal(page.more, true);
  const older = (await app.inject({ url: `/api/admin/audit?limit=2&before=${page.rows[1].id}`, headers: owner })).json();
  assert.ok(older.rows[0].id < page.rows[1].id);
  const found = (await app.inject({ url: `/api/admin/audit?q=${code}`, headers: owner })).json().rows;
  assert.ok(found.length >= 3 && found.every((r: any) => r.detail.includes(code)));
  assert.equal((await app.inject({ url: "/api/admin/audit?q=%25", headers: owner })).json().rows.length, 0, "a % in the filter is a character, not a wildcard");

  // The spreadsheet export cannot be used to run a formula on the admin's machine.
  const csv = await app.inject({ url: "/api/admin/audit.csv", headers: owner });
  assert.match(String(csv.headers["content-type"]), /text\/csv/);
  assert.ok(csv.body.includes("trivia.create"));
  for (const line of csv.body.split("\r\n")) for (const cell of line.split('","')) assert.ok(!/^"?[=+\-@]/.test(cell), `a cell starts a formula: ${cell.slice(0, 30)}`);
  assert.equal((await app.inject({ url: "/api/admin/audit.csv", headers: a })).statusCode, 403);
  await app.close();
});

test("admin overview shows the server's state, and an admin can sign a host out everywhere", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const owner = await session("owner@example.com"), dotted = await session("Dotted.Name@gmail.com");
  assert.equal((await app.inject({ url: "/api/admin/overview", headers: dotted })).statusCode, 403);
  await app.inject({ method: "POST", url: "/api/trivias", headers: dotted, payload: { title: "t", settings: { maxGuesses: 3, timeLimit: 0 }, rounds } });
  const o = (await app.inject({ url: "/api/admin/overview", headers: owner })).json();
  assert.equal(o.status.schema, SCHEMA_VERSION);
  assert.equal(o.status.trivias, 1);
  assert.deepEqual(o.status.unreadableGames, []);
  assert.ok(o.status.dbBytes > 0 && o.status.memoryBytes > 0 && typeof o.status.version === "string");
  const row = o.hosts.find((h: any) => h.email === "dottedname@gmail.com");
  assert.equal(row.trivias, 1, "counted for the host however the address was typed");

  assert.equal((await app.inject({ method: "POST", url: "/api/admin/hosts/signout", headers: dotted, payload: { email: "owner@example.com" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/hosts/signout", headers: owner, payload: { email: "nobody@example.com" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/hosts/signout", headers: owner, payload: { email: row.email } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/me", headers: dotted })).json().host, null, "signed out, though the list spells the address differently");
  assert.ok((await app.inject({ url: "/api/me", headers: owner })).json().host);
  await app.close();
});

test("a database from the previous version gains the record table and the address column in place", async () => {
  const fs = await import("node:fs");
  const path = `${fs.mkdtempSync((process.env.TMPDIR ?? "/tmp") + "/trivia-test-")}/v2.db`;
  let db = openDb(path);
  db.exec("DROP TABLE game_records; ALTER TABLE audit DROP COLUMN ip; DROP INDEX audit_action;");
  db.prepare("INSERT INTO audit (at, actor, action, target) VALUES (1, 'a@example.com', 'session.end', 'session:x')").run();
  db.pragma("user_version = 2");
  db.close();
  db = openDb(path);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(db.prepare("SELECT action, ip FROM audit").get(), { action: "session.end", ip: null }, "old entries are kept");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM game_records").get() as { n: number }).n, 0);
  db.close();
});
