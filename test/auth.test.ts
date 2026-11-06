import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { isAllowedHost, signSession, verifySession } from "../src/auth.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";

const env = {
  BASE_URL: "https://trivia.example.com",
  SESSION_SECRET: "x".repeat(40),
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  HOST_ALLOWLIST: "Host@Example.com, other@example.com",
};
const cfg = loadConfig(env);

test("allowlist is case-insensitive and exact", () => {
  assert.equal(isAllowedHost(cfg, "host@example.com"), true);
  assert.equal(isAllowedHost(cfg, "evil@example.com"), false);
  assert.equal(isAllowedHost(cfg, "host@example.com.evil.io"), false);
});

test("session verifies, but a tampered token or removed host does not", async () => {
  const t = await signSession(cfg, { email: "host@example.com", name: "H" });
  assert.equal((await verifySession(cfg, t))?.email, "host@example.com");
  assert.equal(await verifySession(cfg, t + "x"), null);
  assert.equal(await verifySession(loadConfig({ ...env, HOST_ALLOWLIST: "other@example.com" }), t), null);
  assert.equal(await verifySession(loadConfig({ ...env, SESSION_SECRET: "y".repeat(40) }), t), null);
});

test("API requires login, enforces origin and ownership", async () => {
  const app = await buildApp(cfg, openDb(":memory:"));
  assert.equal((await app.inject("/api/trivias")).statusCode, 401);

  const mk = async (email: string) => `trivia_session=${await signSession(cfg, { email, name: email })}`;
  const alice = await mk("host@example.com");
  const bob = await mk("other@example.com");
  const body = { title: "t", rounds: [{ title: "r", modules: [{ type: "text_qa", config: { question: "q", answers: ["a"] } }] }] };

  const noOrigin = await app.inject({ method: "POST", url: "/api/trivias", headers: { cookie: alice }, payload: body });
  assert.equal(noOrigin.statusCode, 403);

  const h = { cookie: alice, origin: cfg.BASE_URL };
  const created = await app.inject({ method: "POST", url: "/api/trivias", headers: h, payload: body });
  assert.equal(created.statusCode, 201);
  const { id } = created.json();

  assert.equal((await app.inject({ url: `/api/trivias/${id}`, headers: { cookie: alice } })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/trivias/${id}`, headers: { cookie: bob } })).statusCode, 404);

  const bad = await app.inject({ method: "POST", url: "/api/trivias", headers: h, payload: { title: "t", rounds: [{ title: "r", modules: [{ type: "evil", config: {} }] }] } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
