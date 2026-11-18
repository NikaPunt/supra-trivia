import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { pageFor } from "../src/assets.js";

const cfg = loadConfig({ BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", SEED_SAMPLE: "false" });
const app = await buildApp(cfg, openDb(":memory:"), HostDirectory.fromLists({ admins: ["o@example.com"] }));

test("pages point their stylesheet, scripts and icon at the current version, and nothing else", () => {
  const html = '<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/styles.css"><script src="/js/theme.js"></script><a href="/host.html">x</a><script type="module" src="/js/play.js"></script>';
  assert.equal(pageFor(html, "abc"), '<link rel="icon" href="/v/abc/favicon.svg"><link rel="stylesheet" href="/v/abc/styles.css"><script src="/v/abc/js/theme.js"></script><a href="/host.html">x</a><script type="module" src="/v/abc/js/play.js"></script>');
});

test("caching: versioned files are kept for a year, pages are always checked, fonts are kept, old versions still load", async () => {
  const page = await app.inject({ url: "/play.html" });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers["cache-control"], "no-cache");
  const v = /\/v\/([0-9a-f]{12})\/styles\.css/.exec(page.body)?.[1];
  assert.ok(v, "the page points at a versioned stylesheet");
  assert.match(page.body, new RegExp(`src="/v/${v}/js/play\\.js"`));
  assert.equal((await app.inject({ url: "/play.html", headers: { "if-none-match": `"${v}"` } })).statusCode, 304, "an unchanged page costs one tiny answer");
  assert.equal((await app.inject({ url: "/" })).headers.etag, `"${v}"`, "the home page is versioned too");

  const css = await app.inject({ url: `/v/${v}/styles.css` });
  assert.equal(css.statusCode, 200);
  assert.equal(css.headers["cache-control"], "public, max-age=31536000, immutable");
  const mod = await app.inject({ url: `/v/${v}/js/common.js` });
  assert.equal(mod.headers["cache-control"], "public, max-age=31536000, immutable", "scripts loaded by relative path get the same version");

  const old = await app.inject({ url: "/v/000000000000/styles.css" });
  assert.equal(old.statusCode, 200, "a page loaded just before a deploy still gets its files");
  assert.equal(old.headers["cache-control"], "public, max-age=0", "but an old version is not kept");

  const font = await app.inject({ url: "/fonts/fraunces-latin-full-normal.woff2" });
  assert.equal(font.statusCode, 200);
  assert.equal(font.headers["cache-control"], "public, max-age=31536000, immutable");
});

test("the sample trivia's answers are not reachable through the versioned path either", async () => {
  for (const url of ["/starter.json", "/v/abc/starter.json", "/v/abc/../starter.json"]) assert.notEqual((await app.inject({ url })).statusCode, 200, url);
  assert.equal((await app.inject({ url: "/v/abc/play.html" })).statusCode, 404, "pages are only served from their own address");
});

test("compression: styles and scripts are compressed when the browser accepts it; fonts and live streams are not", async () => {
  const css = await app.inject({ url: "/styles.css", headers: { "accept-encoding": "br, gzip" } });
  assert.match(String(css.headers["content-encoding"]), /^(br|gzip)$/);
  assert.ok(css.rawPayload.length < 30000, `the stylesheet went out at ${css.rawPayload.length} bytes`);
  assert.match(String((await app.inject({ url: "/js/builder.js", headers: { "accept-encoding": "gzip" } })).headers["content-encoding"]), /gzip/);
  assert.equal((await app.inject({ url: "/play.html", headers: { "accept-encoding": "gzip" } })).headers["content-encoding"], undefined, "pages are under 1 KB, too small to be worth it");
  assert.equal((await app.inject({ url: "/fonts/fraunces-latin-full-normal.woff2", headers: { "accept-encoding": "gzip" } })).headers["content-encoding"], undefined);
  assert.equal((await app.inject({ url: "/styles.css" })).headers["content-encoding"], undefined, "nothing is compressed for a client that did not ask");
});

test("theme.js asks early for fonts that styles.css really uses, under the same addresses", async () => {
  const { readFileSync } = await import("node:fs");
  const theme = readFileSync(new URL("../public/js/theme.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const names = [...theme.matchAll(/"([a-z0-9-]+-(?:normal|italic))"/g)].map((m) => m[1]);
  assert.ok(names.length >= 3);
  for (const n of names) assert.ok(css.includes(`url("/fonts/${n}.woff2")`), `${n} is in styles.css under the same address`);
});
