import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { HostDirectory } from "./hosts.js";
import { GameStore } from "./store.js";
import { registerRoutes } from "./routes.js";

export async function buildApp(cfg: Config, db: Db, hosts: HostDirectory) {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 256 * 1024 });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid request" });
    req.log.error(err);
    const status = (err as { statusCode?: number }).statusCode;
    return reply.code(status && status < 500 ? status : 500).send({ error: "request failed" });
  });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(fastifyStatic, { root: fileURLToPath(new URL("../public", import.meta.url)) });
  registerRoutes(app, cfg, db, hosts, new GameStore(db));
  return app;
}
