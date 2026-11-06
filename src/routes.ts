import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Ctx } from "./context.js";
import type { Db } from "./db.js";
import type { HostDirectory } from "./hosts.js";
import type { GameStore } from "./store.js";
import { LOGIN_COOKIE, SESSION_COOKIE, SESSION_TTL_S, finishLogin, LoginError, signSession, startLogin, verifySession, type Session } from "./auth.js";
import { modules, roundsSchema, settingsSchema } from "./modules/index.js";
import { loadSample } from "./sample.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerPlayRoutes } from "./play.js";

declare module "fastify" {
  interface FastifyRequest {
    host_session: Session | null;
  }
}

const trivia = z.object({ title: z.string().min(1).max(120), settings: settingsSchema.default({ maxGuesses: 3, timeLimit: 180, wagerCap: false }), rounds: roundsSchema });
/** Enough for any real use; stops a runaway script or a stuck button filling the database. */
export const MAX_TRIVIAS_PER_HOST = 100;
export const idParam = z.object({ id: z.uuid() });

export function registerRoutes(app: FastifyInstance, cfg: Config, db: Db, hosts: HostDirectory, store: GameStore) {
  const secure = cfg.BASE_URL.startsWith("https://");
  const cookieOpts = { httpOnly: true as const, secure, sameSite: "lax" as const, path: "/" };

  app.decorateRequest("host_session", null);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.host_session = await verifySession(cfg, hosts, req.cookies[SESSION_COOKIE]);
  });

  // CSRF: state-changing requests must come from our own origin.
  app.addHook("preHandler", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers.origin !== cfg.BASE_URL) return reply.code(403).send({ error: "bad origin" });
  });

  const requireHost = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.host_session) return reply.code(401).send({ error: "login required" });
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.host_session) return reply.code(401).send({ error: "login required" });
    if (req.host_session.role !== "admin") return reply.code(403).send({ error: "admin only" });
  };
  const audit = (actor: string, action: string, target: string, detail?: unknown) => {
    db.prepare("INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)").run(
      Date.now(), actor, action, target, detail === undefined ? null : JSON.stringify(detail),
    );
  };
  const ctx: Ctx = { cfg, db, hosts, store, cookieOpts, requireHost, requireAdmin, audit };

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/auth/login", async (_req, reply) => {
    const { url, cookie, maxAge } = await startLogin(cfg);
    reply.setCookie(LOGIN_COOKIE, cookie, { ...cookieOpts, maxAge, path: "/auth" }).redirect(url);
  });

  app.get("/auth/callback", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const session = await finishLogin(cfg, hosts, req.cookies[LOGIN_COOKIE], req.query as any);
      reply
        .clearCookie(LOGIN_COOKIE, { path: "/auth" })
        .setCookie(SESSION_COOKIE, await signSession(cfg, session), { ...cookieOpts, maxAge: SESSION_TTL_S })
        .redirect("/host.html");
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, "login failed");
      reply.code(e instanceof LoginError ? 403 : 502).send({ error: "login failed" });
    }
  });

  app.post("/auth/logout", async (_req, reply) => reply.clearCookie(SESSION_COOKIE, cookieOpts).send({ ok: true }));

  app.get("/api/me", async (req) => ({ host: req.host_session }));

  app.get("/api/modules", { preHandler: requireHost }, async () =>
    modules.map((m) => ({ type: m.type, label: m.label, description: m.description, fields: m.fields, input: m.input })),
  );

  // ---- trivias: hosts see their own; admins can see and manage everyone's ----

  // Every host gets one copy of the sample the first time they open their list, and it is theirs to edit or delete.
  // A record of who has had one stops it coming back after a delete.
  const sample = cfg.SEED_SAMPLE ? loadSample() : null;
  const seedSample = db.transaction((email: string) => {
    if (!sample || db.prepare("INSERT OR IGNORE INTO seeded (host_email, at) VALUES (?, ?)").run(email, Date.now()).changes === 0) return;
    const now = Date.now();
    db.prepare("INSERT INTO trivias (id, host_email, title, rounds, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      randomUUID(), email, sample.title, JSON.stringify(sample.rounds), now, now, JSON.stringify(sample.settings),
    );
  });

  app.get("/api/trivias", { preHandler: requireHost }, async (req) => {
    const u = req.host_session!;
    const all = u.role === "admin" && (req.query as any).all === "1";
    if (!all) seedSample(u.email);
    return db
      .prepare(`SELECT id, title, host_email AS owner, updated_at FROM trivias ${all ? "" : "WHERE host_email = ?"} ORDER BY updated_at DESC`)
      .all(...(all ? [] : [u.email]));
  });

  const full = (email: string) => (db.prepare("SELECT COUNT(*) AS n FROM trivias WHERE host_email = ?").get(email) as { n: number }).n >= MAX_TRIVIAS_PER_HOST;
  const tooMany = { error: `You already have ${MAX_TRIVIAS_PER_HOST} trivias, the most allowed. Delete some you no longer need first.` };

  app.post("/api/trivias", { preHandler: requireHost }, async (req, reply) => {
    if (full(req.host_session!.email)) return reply.code(429).send(tooMany);
    const body = trivia.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const id = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO trivias (id, host_email, title, rounds, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id, req.host_session!.email, body.data.title, JSON.stringify(body.data.rounds), now, now, JSON.stringify(body.data.settings),
    );
    return reply.code(201).send({ id });
  });

  type Row = { id: string; host_email: string; title: string; rounds: string; settings: string };
  const load = (req: FastifyRequest): Row | undefined => {
    const u = req.host_session!;
    const row = db.prepare("SELECT * FROM trivias WHERE id = ?").get(idParam.parse(req.params).id) as Row | undefined;
    return row && (u.role === "admin" || row.host_email === u.email) ? row : undefined;
  };
  const touchOthers = (req: FastifyRequest, row: Row, action: string) => {
    if (row.host_email !== req.host_session!.email) audit(req.host_session!.email, action, `trivia:${row.id}`, { owner: row.host_email });
  };

  app.get("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const raw = JSON.parse(row.rounds);
    // Older trivias are folded into the one-question form on the way out, so the builder only ever sees the new shape.
    const upgraded = roundsSchema.safeParse(raw);
    return { id: row.id, title: row.title, owner: row.host_email, settings: settingsSchema.parse(JSON.parse(row.settings)), rounds: upgraded.success ? upgraded.data : raw };
  });

  app.put("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const body = trivia.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    db.prepare("UPDATE trivias SET title = ?, rounds = ?, settings = ?, updated_at = ? WHERE id = ?").run(
      body.data.title, JSON.stringify(body.data.rounds), JSON.stringify(body.data.settings), Date.now(), row.id,
    );
    touchOthers(req, row, "trivia.edit");
    return { ok: true };
  });

  // A copy to edit, so nobody has to start from scratch. It belongs to whoever makes it (an admin copying someone's trivia gets their own).
  app.post("/api/trivias/:id/duplicate", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    if (full(req.host_session!.email)) return reply.code(429).send(tooMany);
    const parsed = roundsSchema.safeParse(JSON.parse(row.rounds)); // also folds trivias saved with the older clue boxes
    const rounds = JSON.stringify(parsed.success ? parsed.data : JSON.parse(row.rounds));
    const title = `${row.title.slice(0, 120 - " (copy)".length)} (copy)`;
    const id = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO trivias (id, host_email, title, rounds, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id, req.host_session!.email, title, rounds, now, now, row.settings,
    );
    touchOthers(req, row, "trivia.duplicate");
    return reply.code(201).send({ id, title });
  });

  app.delete("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    db.prepare("DELETE FROM trivias WHERE id = ?").run(row.id);
    touchOthers(req, row, "trivia.delete");
    return { ok: true };
  });

  registerSessionRoutes(app, ctx, load);
  registerPlayRoutes(app, ctx);
}
