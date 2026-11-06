import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { registerRoutes } from "./routes.js";

export async function buildApp(cfg: Config, db: Db) {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 256 * 1024 });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  registerRoutes(app, cfg, db);
  return app;
}
