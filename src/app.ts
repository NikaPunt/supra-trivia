import Fastify, { LogController, type FastifyRequest, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { HostDirectory } from "./hosts.js";
import { PLAYER_COOKIE, verifyPlayer } from "./auth.js";
import { GameStore } from "./store.js";
import { registerRoutes } from "./routes.js";

export async function buildApp(cfg: Config, db: Db, hosts: HostDirectory) {
  const options: FastifyServerOptions = {
    logger: {
      level: cfg.LOG_LEVEL,
      serializers: {
        // The Google sign-in code arrives in the address of /auth/callback; it has no business in the logs.
        req: (req: FastifyRequest) => ({ method: req.method, url: /^\/auth\//.test(req.url) ? req.url.split("?")[0] : req.url, host: req.host, remoteAddress: req.ip, remotePort: req.socket?.remotePort }),
      },
    },
    // One line per request, written by the hook below, in place of the two the framework would write.
    logController: new LogController({ disableRequestLogging: true }),
    // Only the proxies we were told about are believed, so a visitor cannot invent the address they are counted under.
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    // Live-update streams never finish by themselves; without this a shutdown would wait on them for ever.
    forceCloseConnections: true,
  };
  const app = Fastify(options);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid request" });
    const status = (err as { statusCode?: number }).statusCode;
    // A refused request is the app working, not failing: only real faults are logged as errors, with their stack.
    if (status && status < 500) return reply.code(status).send({ error: status === 429 ? "too many requests, slow down" : "request failed" });
    req.log.error({ err, who: req.who ?? undefined }, "request failed");
    return reply.code(500).send({ error: "request failed" });
  });
  // The request log. Changes, refusals and faults are always written; plain reads (pages, polls, health checks) only at debug,
  // so a busy game night does not bury the lines that matter. Query strings on /auth/ are dropped: they carry sign-in codes.
  app.addHook("onResponse", async (req, reply) => {
    const status = reply.statusCode;
    const level = status >= 500 ? "error" : status === 429 || status === 403 ? "warn" : status >= 400 || !["GET", "HEAD", "OPTIONS"].includes(req.method) ? "info" : "debug";
    req.log[level]({
      method: req.method,
      url: /^\/auth\//.test(req.url) ? req.url.split("?")[0] : req.url,
      status,
      ms: Math.round(reply.elapsedTime),
      ip: req.ip,
      who: req.who ?? undefined,
    }, "request");
  });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    // Pages, scripts, fonts and images are not worth limiting, and a phone loads a dozen of them.
    allowList: (req) => req.method === "GET" && !/^\/(api|auth)\//.test(req.url),
    // Friends at one party share a public IP, so a player or host who has proved who they are is counted on their own.
    // Only a cookie that verifies counts: anything else (no cookie, a made-up one) is counted by address, as are
    // joining and logging in, which are the abuse targets.
    keyGenerator: async (req) => {
      if (/^\/(api\/join|auth\/)/.test(req.url)) return req.ip;
      if (req.host_session) return `h:${req.host_session.email}`;
      const p = await verifyPlayer(cfg, req.cookies?.[PLAYER_COOKIE]);
      return p ? `p:${p.sid}:${p.pid}` : req.ip;
    },
  });
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../public", import.meta.url)),
    // The sample trivia holds its own answers; signed-in hosts get it from a route of its own.
    allowedPath: (pathName) => !/starter\.json$/i.test(pathName),
  });
  const store = new GameStore(db, cfg.GAME_RETENTION_DAYS);
  app.addHook("onClose", async () => store.close());
  app.log.info({ games: store.counts, retentionDays: cfg.GAME_RETENTION_DAYS }, "games loaded");
  if (store.unreadable.length) app.log.error({ ids: store.unreadable }, "some stored games could not be read and were skipped; they are still in the database");
  registerRoutes(app, cfg, db, hosts, store);
  return app;
}
