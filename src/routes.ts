import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { LOGIN_COOKIE, SESSION_COOKIE, finishLogin, LoginError, signSession, startLogin, verifySession, type Session } from "./auth.js";
import { modules, roundsSchema } from "./modules/index.js";

declare module "fastify" {
  interface FastifyRequest {
    host_session: Session | null;
  }
}

const trivia = z.object({ title: z.string().min(1).max(120), rounds: roundsSchema });
const idParam = z.object({ id: z.uuid() });

export function registerRoutes(app: FastifyInstance, cfg: Config, db: Db) {
  const secure = cfg.BASE_URL.startsWith("https://");
  const cookieOpts = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };

  app.decorateRequest("host_session", null);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.host_session = await verifySession(cfg, req.cookies[SESSION_COOKIE]);
  });

  // CSRF: state-changing requests must come from our own origin.
  app.addHook("preHandler", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers.origin !== cfg.BASE_URL) return reply.code(403).send({ error: "bad origin" });
  });

  const requireHost = async (req: FastifyRequest, reply: any) => {
    if (!req.host_session) return reply.code(401).send({ error: "login required" });
  };

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/auth/login", async (_req, reply) => {
    const { url, cookie, maxAge } = await startLogin(cfg);
    reply.setCookie(LOGIN_COOKIE, cookie, { ...cookieOpts, maxAge, path: "/auth" }).redirect(url);
  });

  app.get("/auth/callback", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const session = await finishLogin(cfg, req.cookies[LOGIN_COOKIE], req.query as any);
      reply
        .clearCookie(LOGIN_COOKIE, { path: "/auth" })
        .setCookie(SESSION_COOKIE, await signSession(cfg, session), { ...cookieOpts, maxAge: 8 * 3600 })
        .redirect("/");
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, "login failed");
      reply.code(e instanceof LoginError ? 403 : 502).send({ error: "login failed" });
    }
  });

  app.post("/auth/logout", async (_req, reply) => reply.clearCookie(SESSION_COOKIE, cookieOpts).send({ ok: true }));

  app.get("/api/me", async (req) => ({ host: req.host_session }));

  app.get("/api/modules", { preHandler: requireHost }, async () =>
    modules.map((m) => ({ type: m.type, label: m.label, description: m.description })),
  );

  app.get("/api/trivias", { preHandler: requireHost }, async (req) =>
    db
      .prepare("SELECT id, title, updated_at FROM trivias WHERE host_email = ? ORDER BY updated_at DESC")
      .all(req.host_session!.email),
  );

  app.post("/api/trivias", { preHandler: requireHost }, async (req, reply) => {
    const body = trivia.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const id = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO trivias VALUES (?, ?, ?, ?, ?, ?)").run(
      id, req.host_session!.email, body.data.title, JSON.stringify(body.data.rounds), now, now,
    );
    return reply.code(201).send({ id });
  });

  const load = (req: FastifyRequest) => {
    const { id } = idParam.parse(req.params);
    return db.prepare("SELECT * FROM trivias WHERE id = ? AND host_email = ?").get(id, req.host_session!.email) as
      | { id: string; title: string; rounds: string }
      | undefined;
  };

  app.get("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    return { id: row.id, title: row.title, rounds: JSON.parse(row.rounds) };
  });

  app.put("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    if (!load(req)) return reply.code(404).send({ error: "not found" });
    const body = trivia.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    db.prepare("UPDATE trivias SET title = ?, rounds = ?, updated_at = ? WHERE id = ?").run(
      body.data.title, JSON.stringify(body.data.rounds), Date.now(), idParam.parse(req.params).id,
    );
    return { ok: true };
  });

  app.delete("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    if (!load(req)) return reply.code(404).send({ error: "not found" });
    db.prepare("DELETE FROM trivias WHERE id = ?").run(idParam.parse(req.params).id);
    return { ok: true };
  });
}
