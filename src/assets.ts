import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Browser caching without stale pages.
 *
 * The pages point at their stylesheet, scripts and icon under /v/<version>/, where <version> is a fingerprint of every
 * file in public/. Anything under the current /v/<version>/ can be kept by browsers for a year, because the moment any
 * file changes the fingerprint changes, the pages point somewhere new, and nothing old is reused. The scripts load each
 * other by relative paths, so they all come from the same version and a page never mixes old and new files.
 * The pages themselves are always checked with the server (one small request that usually answers "not changed").
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** A short fingerprint of everything in public/: names and contents. */
export function assetVersion(publicDir: string): string {
  const h = createHash("sha256");
  for (const f of files(publicDir).sort()) h.update(relative(publicDir, f)).update("\0").update(readFileSync(f)).update("\0");
  return h.digest("hex").slice(0, 12);
}

/** A page with its stylesheet, scripts and icon pointed at the versioned copies. */
export const pageFor = (html: string, version: string): string =>
  html.replace(/(href|src)="\/(styles\.css|favicon\.svg|js\/[^"]+)"/g, (_m, attr, path) => `${attr}="/v/${version}/${path}"`);

export function registerPages(app: FastifyInstance, publicDir: string): string {
  const version = assetVersion(publicDir);
  const etag = `"${version}"`;
  const pages = new Map<string, string>();
  for (const f of readdirSync(publicDir)) if (f.endsWith(".html")) pages.set(f, pageFor(readFileSync(join(publicDir, f), "utf8"), version));

  for (const [file, html] of pages) {
    const send = async (req: { headers: Record<string, unknown> }, reply: import("fastify").FastifyReply) => {
      reply.header("cache-control", "no-cache").header("etag", etag);
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply.type("text/html; charset=utf-8").send(html);
    };
    app.get(`/${file}`, send);
    if (file === "index.html") app.get("/", send);
  }

  app.get("/v/:version/*", async (req, reply) => {
    const { version: asked, "*": path } = req.params as { version: string; "*": string };
    // The sample trivia holds its own answers; it is never served as a file.
    if (/starter\.json$/i.test(path) || path.endsWith(".html")) return reply.code(404).send({ error: "not found" });
    // Only the current version is kept for good. An older one (a page loaded just before a deploy) still works, but is not cached.
    const current = asked === version;
    return reply.sendFile(path, { cacheControl: true, maxAge: current ? 365 * 24 * 3600 * 1000 : 0, immutable: current });
  });
  return version;
}
