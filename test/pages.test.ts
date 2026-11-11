import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";
// @ts-expect-error plain browser module with no types
import { connectionWatch } from "../public/js/layout.js";

// The pages are plain browser scripts with no test runner of their own, so these pin down what they rely on:
// the server answers the home page's "am I already at a table?" question correctly, and the live pages
// recover from a failed refresh instead of staying on the error.

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const hosts = HostDirectory.fromLists({ admins: ["o@example.com"] });
const trivia = { title: "t", settings: { maxGuesses: 3 }, rounds: [{ title: "R", modules: [{ type: "text_qa", config: { question: "Q?", answers: ["a"] } }] }] };
const src = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");

async function setup() {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const host = { cookie: "trivia_session=" + (await signSession(cfg, { email: "o@example.com", name: "O" })), origin: cfg.BASE_URL };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: host })).json();
  return { app, host, id, code };
}

test("the home page's questions to the server never get a 4xx for an ordinary visitor (a proxy ban list counts those)", async () => {
  const { app } = await setup();
  for (const url of ["/api/me", "/api/play/where"]) {
    const r = await app.inject({ url });
    assert.equal(r.statusCode, 200, `${url} answers a stranger plainly`);
  }
  assert.deepEqual((await app.inject({ url: "/api/play/where" })).json(), { table: null });
  const forged = await app.inject({ url: "/api/play/where", headers: { cookie: "trivia_player=not.a.token" } });
  assert.equal(forged.statusCode, 200);
  assert.deepEqual(forged.json(), { table: null });
  const js = src("js/index.js");
  const calls = [...js.matchAll(/api\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(calls.sort(), ["/api/join", "/api/me", "/api/play/where"], "on load the home page asks only /api/me and /api/play/where (/api/join is the form being sent)");
});

test("the home page can tell a player who is already at a table (no PIN needed) from a stranger", async () => {
  const { app, host, id, code } = await setup();
  assert.equal((await app.inject({ url: "/api/play/state" })).statusCode, 401, "the game screen itself still refuses a stranger");

  const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "NoPin" } });
  const cookie = String(j.headers["set-cookie"]).split(";")[0]!;
  const w = (await app.inject({ url: "/api/play/where", headers: { cookie } })).json().table;
  assert.deepEqual([w.me, w.code], ["NoPin", code]);
  assert.notEqual(w.phase, "ended");

  // The same name without the cookie or a PIN is still refused: the resume link is the only way back.
  const again = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "NoPin" } });
  assert.equal(again.statusCode, 409);

  await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: { action: "begin" } });
  await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: { action: "end" } });
  assert.equal((await app.inject({ url: "/api/play/where", headers: { cookie } })).json().table.phase, "ended", "the page hides the link once the session has ended");
  const kicked = await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: { action: "kick", playerId: "00000000-0000-4000-8000-000000000000" } });
  assert.equal(kicked.statusCode, 404);
});

test("the home page offers a way back to the game, hidden until it is needed", async () => {
  const html = src("index.html"), js = src("js/index.js"), css = src("styles.css");
  assert.match(html, /id="resume"[^>]*\bhidden\b/);
  assert.match(js, /api\("\/api\/play\/where"\)/);
  assert.match(js, /href: "\/play\.html"/);
  assert.match(js, /phase === "ended"/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/, "hidden must win over card styling");
});

test("the host console and the projector keep their screen and retry after a failed refresh", async () => {
  for (const f of ["js/session.js", "js/deck.js"]) {
    const code = src(f);
    const at = code.lastIndexOf("} catch (e) {"); // the one in refresh(), the last in each file
    const catchBlock = code.slice(at, code.indexOf("}\n}", at));
    assert.match(catchBlock, /status === 401\) \{ location\.href = "\/auth\/login"/, `${f} goes to sign-in when signed out, instead of retrying a refused request every few seconds`);
    assert.match(catchBlock, /lastRaw = ""/, `${f} forgets what it drew, or an unchanged game never redraws`);
    assert.match(catchBlock, /setTimeout\(refresh, \d+\)/, `${f} retries soon instead of waiting for the slow poll`);
    assert.match(catchBlock, /conn\.failed\(\)/, `${f} says it is reconnecting instead of blanking the screen`);
    assert.ok(catchBlock.indexOf("conn.failed()") < catchBlock.indexOf('class: "err"'), `${f} shows the bare error only when nothing has been drawn yet`);
    assert.match(code, /await api\(`\/api\/sessions\/\$\{id\}(\/deck)?`\);\s*conn\.ok\(\);/, `${f} clears the note on the first good refresh`);
  }
});

test("the reconnecting note: nothing for a short blip, one note once trouble lasts, gone on the next good refresh", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  try {
    const log: string[] = [];
    const w = connectionWatch(4000, () => log.push("show"), () => log.push("hide"));
    w.failed(); mock.timers.tick(1500); w.failed(); mock.timers.tick(1500);
    w.ok();
    mock.timers.tick(10_000);
    assert.deepEqual(log, [], "a three-second blip shows nothing at all, then or later");

    w.failed(); mock.timers.tick(3000); w.failed();
    assert.deepEqual(log, [], "still quiet before the delay");
    mock.timers.tick(1000);
    assert.deepEqual(log, ["show"], "shown once after four seconds of failing");
    w.failed(); mock.timers.tick(3000); w.failed(); mock.timers.tick(3000);
    assert.deepEqual(log, ["show"], "and not again while it carries on");
    w.ok();
    assert.deepEqual(log, ["show", "hide"], "hidden by the first good refresh");
    w.ok(); w.ok();
    assert.deepEqual(log, ["show", "hide"], "good refreshes after that change nothing");
    w.failed(); mock.timers.tick(4000);
    assert.deepEqual(log, ["show", "hide", "show"], "a later outage is announced afresh");
  } finally {
    mock.timers.reset();
  }
});

test("the new screens are wired in: My answers on phones, All questions on the host console, answers sorted, wrong guesses crossed off", () => {
  const play = src("js/play.js"), session = src("js/session.js"), css = src("styles.css"), common = src("js/common.js"), deck = src("js/deck.js");
  assert.match(play, /\/api\/play\/history/);
  assert.match(play, /"My answers"/);
  assert.match(play, /g\.struck/);
  assert.match(play, /foldGuesses\(t\.myGuesses, showAllTheme\)/, "older theme guesses fold away");
  assert.match(session, /\/api\/sessions\/\$\{id\}\/outline/);
  assert.match(session, /"All questions"/);
  assert.match(session, /answerOrder\(s\.answers\)/);
  assert.match(session, /g\.status === "rejected" \? "struck"/);
  assert.match(common, /deckGrid\(rows\.length\)/);
  assert.match(deck, /deck: true/);
  assert.match(css, /\.struck/);
  assert.match(css, /body\.deck \.sign\.big/);
});
