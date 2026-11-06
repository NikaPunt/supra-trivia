import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

// A team is one player that several phones have joined with the same name and PIN.

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s" });
const hosts = HostDirectory.fromLists({ admins: ["o@example.com"] });
const trivia = { title: "t", settings: { maxGuesses: 3 }, rounds: [{ title: "R", modules: [
  { type: "text_qa", config: { question: "Which country?", answers: ["Nepal"] } },
  { type: "text_qa", config: { question: "Second?", answers: ["b"] } },
] }] };

async function setup() {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const host = { cookie: "trivia_session=" + (await signSession(cfg, { email: "o@example.com", name: "O" })), origin: cfg.BASE_URL };
  const { id: tid } = (await app.inject({ method: "POST", url: "/api/trivias", headers: host, payload: trivia })).json();
  const { id, code } = (await app.inject({ method: "POST", url: `/api/trivias/${tid}/sessions`, headers: host })).json();
  const act = (a: object) => app.inject({ method: "POST", url: `/api/sessions/${id}/action`, headers: host, payload: a });
  await act({ action: "begin" });
  const phone = async (device: string, team = "Rockets") => {
    const j = await app.inject({ method: "POST", url: "/api/join", headers: { origin: cfg.BASE_URL }, payload: { code, nickname: team, pin: "1234" } });
    assert.equal(j.statusCode, 200);
    return { cookie: String(j.headers["set-cookie"]).split(";")[0]!, origin: cfg.BASE_URL, "x-device": device };
  };
  const say = (p: object, text: string) => app.inject({ method: "POST", url: "/api/play/answer", headers: p as any, payload: { value: { text } } });
  const view = async (p: object) => (await app.inject({ url: "/api/play/state", headers: p as any })).json();
  return { app, host, id, act, phone, say, view };
}

test("two phones on one team share the allowance and each sees what the other tried", async () => {
  const { app, host, id, act, phone, say, view } = await setup();
  const A = await phone("device-aaaa-1111");
  const B = await phone("device-bbbb-2222");

  assert.equal((await say(A, "nepal")).statusCode, 200);
  assert.equal((await say(B, "bhutan")).statusCode, 200);

  const va = await view(A), vb = await view(B);
  assert.deepEqual(va.guessLog.map((e: any) => [e.value.text, e.you, e.current]), [["nepal", true, false], ["bhutan", false, true]]);
  assert.deepEqual(vb.guessLog.map((e: any) => [e.value.text, e.you, e.current]), [["nepal", false, false], ["bhutan", true, true]]);
  assert.deepEqual(va.myAnswers, vb.myAnswers, "both phones show the same locked-in answer");
  assert.equal(va.guessesLeft, 1);
  assert.equal(vb.guessesLeft, 1, "one shared allowance, not one each");

  const dup = await say(A, "bhutan");
  assert.equal(dup.statusCode, 400);
  assert.match(dup.json().error, /your team already gave that answer/);

  assert.equal((await say(A, "tibet")).statusCode, 200);
  assert.equal((await say(B, "sikkim")).statusCode, 429, "the allowance is used up for everyone");
  assert.equal((await view(B)).guessLog.length, 3);

  assert.equal((await app.inject({ url: `/api/sessions/${id}`, headers: host })).json().playerList.length, 1, "the host sees one team, not one per phone");

  await act({ action: "next" });
  assert.equal((await view(A)).guessLog.length, 0, "the history belongs to the question and starts fresh");
  await app.close();
});

test("a missing or odd phone id never breaks anything", async () => {
  const { app, phone, say, view } = await setup();
  const A = await phone("device-aaaa-1111");
  const bare = { ...A }; delete (bare as any)["x-device"];
  const odd = { ...A, "x-device": "!!bad id!!" };
  assert.equal((await say(bare, "nepal")).statusCode, 200);
  assert.equal((await say(odd, "bhutan")).statusCode, 200);
  const v = await view(A);
  assert.deepEqual(v.guessLog.map((e: any) => e.you), [false, false], "guesses without a valid id are simply not 'you'");
  await app.close();
});

test("a burst of simultaneous guesses from several phones cannot beat the limit and leaves everyone agreeing", async () => {
  const { app, phone, say, view } = await setup();
  const phones = [await phone("device-aaaa-1111"), await phone("device-bbbb-2222"), await phone("device-cccc-3333")];
  const results = await Promise.all(Array.from({ length: 9 }, (_, i) => say(phones[i % 3]!, `guess${i}`)));
  const codes = results.map((r) => r.statusCode);
  assert.equal(codes.filter((c) => c === 200).length, 3, "exactly the allowed three got through");
  assert.equal(codes.filter((c) => c === 429).length, 6);
  const views = await Promise.all(phones.map(view));
  assert.equal(new Set(views.map((v) => JSON.stringify(v.myAnswers))).size, 1, "every phone shows the same answer");
  assert.equal(new Set(views.map((v) => v.guessLog.map((e: any) => e.value.text).join(","))).size, 1, "and the same history");
  const last = views[0].guessLog.at(-1);
  assert.equal(views[0].myAnswers[0].value.text, last.value.text, "the locked-in answer is the most recent guess");
  await app.close();
});

test("live updates reach every phone on a team at the same moment", async () => {
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const host = { "content-type": "application/json", origin: cfg.BASE_URL, cookie: "trivia_session=" + (await signSession(cfg, { email: "o@example.com", name: "O" })) };
  const post = async (path: string, body: object, headers: object = host) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: cfg.BASE_URL, ...headers } as any, body: JSON.stringify(body) });
  const { id: tid } = await (await post("/api/trivias", trivia)).json() as any;
  const { id, code } = await (await post(`/api/trivias/${tid}/sessions`, {})).json() as any;
  const cookies: string[] = [];
  for (let i = 0; i < 3; i++) cookies.push((await post("/api/join", { code, nickname: "Rockets", pin: "1234" }, {})).headers.get("set-cookie")!.split(";")[0]!);

  // Three phones open their live stream; each notes when a "changed" event arrives.
  const ctl = new AbortController();
  const arrivals: number[] = [];
  let ready = 0;
  const open = async (cookie: string) => {
    const res = await fetch(base + "/api/play/events", { headers: { cookie }, signal: ctl.signal });
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    return new Promise<void>((resolve) => {
      (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) return; const text = dec.decode(value); if (text.includes("event: ping")) ready++; if (text.includes("event: changed")) { arrivals.push(performance.now()); resolve(); } } } catch { resolve(); } })();
    });
  };
  const waits = cookies.map(open);
  for (let i = 0; i < 100 && ready < 3; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(ready, 3, "all three phones connected");
  const t0 = performance.now();
  await post(`/api/sessions/${id}/action`, { action: "begin" });
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 3000))]);
  ctl.abort();
  assert.equal(arrivals.length, 3, "every phone was told");
  const spread = Math.max(...arrivals) - Math.min(...arrivals);
  assert.ok(Math.max(...arrivals) - t0 < 1000, `first to last within a second (took ${Math.round(Math.max(...arrivals) - t0)}ms)`);
  assert.ok(spread < 250, `phones are told within a quarter second of each other (spread ${Math.round(spread)}ms)`);
  await app.close();
});
