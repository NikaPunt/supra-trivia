import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

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

test("the home page can tell a player who is already at a table (no PIN needed) from a stranger", async () => {
  const { app, host, id, code } = await setup();
  const stranger = await app.inject({ url: "/api/play/state" });
  assert.equal(stranger.statusCode, 401, "a visitor with no cookie is not at a table");

  const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "NoPin" } });
  const cookie = String(j.headers["set-cookie"]).split(";")[0]!;
  const s = (await app.inject({ url: "/api/play/state", headers: { cookie } })).json();
  assert.equal(s.me, "NoPin");
  assert.equal(s.code, code);
  assert.notEqual(s.phase, "ended");

  // The same name without the cookie or a PIN is still refused: the resume link is the only way back.
  const again = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: "NoPin" } });
  assert.equal(again.statusCode, 409);

  await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: { action: "begin" } });
  await app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: { action: "end" } });
  assert.equal((await app.inject({ url: "/api/play/state", headers: { cookie } })).json().phase, "ended", "the page hides the link once the session has ended");
});

test("the home page offers a way back to the game, hidden until it is needed", async () => {
  const html = src("index.html"), js = src("js/index.js"), css = src("styles.css");
  assert.match(html, /id="resume"[^>]*\bhidden\b/);
  assert.match(js, /api\("\/api\/play\/state"\)/);
  assert.match(js, /href: "\/play\.html"/);
  assert.match(js, /phase === "ended"/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/, "hidden must win over card styling");
});

test("the host console and the projector redraw and retry after a failed refresh", async () => {
  for (const f of ["js/session.js", "js/deck.js"]) {
    const catchLine = src(f).split("\n").find((l) => /catch \(e\) \{.*mount\(\$\("#app"\), h\("p", \{ class: "err" \}/.test(l));
    assert.ok(catchLine, `${f} shows refresh errors`);
    assert.match(catchLine!, /lastRaw = ""/, `${f} forgets what it drew, or an unchanged game never redraws`);
    assert.match(catchLine!, /setTimeout\(refresh, \d+\)/, `${f} retries soon instead of waiting for the slow poll`);
  }
});
