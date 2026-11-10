import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Ctx } from "./context.js";
import type { Db } from "./db.js";
import { norm, type HostDirectory } from "./hosts.js";
import { SCHEMA_VERSION } from "./db.js";
import type { GameStore } from "./store.js";
import { LOGIN_COOKIE, SESSION_COOKIE, SESSION_TTL_S, finishLogin, LoginError, signSession, startLogin, verifySession, type Session } from "./auth.js";
import { modules, roundsSchema, settingsSchema } from "./modules/index.js";
import { describeProblems } from "./problems.js";
import { loadSample } from "./sample.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerPlayRoutes } from "./play.js";
import { Streams } from "./streams.js";
import { readFileSync } from "node:fs";

declare module "fastify" {
  interface FastifyRequest {
    host_session: Session | null;
    /** Who made the request, for the log: "host:<email>" or "player:<nickname>@<room code>". */
    who: string | null;
  }
}

const trivia = z.object({ title: z.string().min(1).max(120), settings: settingsSchema.default({ maxGuesses: 3, timeLimit: 180 }), rounds: roundsSchema });
/** Enough for any real use; stops a runaway script or a stuck button filling the database. */
export const MAX_TRIVIAS_PER_HOST = 100;
/** A builder draft is the editor's own working shape, possibly half-finished, so it is stored as given and only ever handed back to the same host. */
export const MAX_DRAFT_BYTES = 1_000_000;
/** Request size for a draft: the draft is JSON inside JSON, so quoting can nearly double it. A draft must never be refused for being bigger than a trivia can be saved. */
const DRAFT_REQUEST_LIMIT = 3 * 1024 * 1024;
const draftBody = z.object({ state: z.string().max(MAX_DRAFT_BYTES).refine((x) => { try { const v = JSON.parse(x); return !!v && typeof v === "object" && !Array.isArray(v); } catch { return false; } }) });
export const idParam = z.object({ id: z.uuid() });

export function registerRoutes(app: FastifyInstance, cfg: Config, db: Db, hosts: HostDirectory, store: GameStore) {
  const secure = cfg.BASE_URL.startsWith("https://");
  const cookieOpts = { httpOnly: true as const, secure, sameSite: "lax" as const, path: "/" };

  // Each host's sign-out counter. A session must carry the current value, so raising it ends all of that host's sessions.
  const readEpoch = db.prepare("SELECT epoch FROM host_auth WHERE host_email = ?");
  const epochOf = (email: string) => (readEpoch.get(norm(email)) as { epoch: number } | undefined)?.epoch ?? 0;
  const signOutEverywhere = (email: string) =>
    db.prepare("INSERT INTO host_auth (host_email, epoch) VALUES (?, 1) ON CONFLICT(host_email) DO UPDATE SET epoch = epoch + 1").run(norm(email));

  app.decorateRequest("host_session", null);
  app.decorateRequest("who", null);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    req.host_session = await verifySession(cfg, hosts, req.cookies[SESSION_COOKIE], epochOf);
    if (req.host_session) req.who = `host:${req.host_session.email}`;
  });

  // CSRF: state-changing requests must come from our own origin.
  app.addHook("preHandler", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers.origin !== cfg.BASE_URL) {
      req.log.warn({ origin: req.headers.origin ?? null }, "refused: request did not come from this site");
      return reply.code(403).send({ error: "bad origin" });
    }
  });

  const requireHost = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.host_session) return reply.code(401).send({ error: "login required" });
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.host_session) return reply.code(401).send({ error: "login required" });
    if (req.host_session.role !== "admin") return reply.code(403).send({ error: "admin only" });
  };
  const addAudit = db.prepare("INSERT INTO audit (at, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)");
  const audit: Ctx["audit"] = (req, action, target, detail, actor) => {
    const who = actor ?? req?.host_session?.email ?? "unknown";
    addAudit.run(Date.now(), who, action, target, detail === undefined ? null : JSON.stringify(detail), req?.ip ?? null);
    // The same line goes to the log, so the two can be matched up by request id.
    (req?.log ?? app.log).info({ audit: action, actor: who, target }, "audit");
  };
  if (cfg.AUDIT_RETENTION_DAYS > 0) {
    const trim = () => db.prepare("DELETE FROM audit WHERE at < ?").run(Date.now() - cfg.AUDIT_RETENTION_DAYS * 24 * 3600 * 1000);
    trim();
    const t = setInterval(trim, 24 * 3600 * 1000);
    t.unref?.();
    app.addHook("onClose", async () => clearInterval(t));
  }
  const streams = new Streams();
  app.addHook("onClose", async () => streams.closeAll());
  const ctx: Ctx = { cfg, db, hosts, store, streams, cookieOpts, requireHost, requireAdmin, audit };

  // Healthy means the database answers, not only that the process is up.
  const ping = db.prepare("SELECT 1");
  app.get("/healthz", async (_req, reply) => {
    try {
      ping.get();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  // The sample trivia, answers and all, for the builder's "Load sample trivia" button: hosts only.
  const samplePath = new URL("../public/starter.json", import.meta.url);
  app.get("/starter.json", { preHandler: requireHost }, async (_req, reply) => {
    try {
      return reply.type("application/json").send(readFileSync(samplePath, "utf8"));
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.get("/auth/login", async (_req, reply) => {
    const { url, cookie, maxAge } = await startLogin(cfg);
    reply.setCookie(LOGIN_COOKIE, cookie, { ...cookieOpts, maxAge, path: "/auth" }).redirect(url);
  });

  app.get("/auth/callback", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const session = await finishLogin(cfg, hosts, req.cookies[LOGIN_COOKIE], req.query as any);
      audit(req, "auth.login", `host:${session.email}`, { role: session.role }, session.email);
      reply
        .clearCookie(LOGIN_COOKIE, { path: "/auth" })
        .setCookie(SESSION_COOKIE, await signSession(cfg, session, epochOf(session.email)), { ...cookieOpts, maxAge: SESSION_TTL_S })
        .redirect("/host.html");
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, "login failed");
      // Someone Google vouched for, who is not a host: worth a line the owner will see.
      if (e instanceof LoginError && e.email) audit(req, "auth.login_denied", `host:${e.email}`, { reason: e.message }, e.email);
      reply.code(e instanceof LoginError ? 403 : 502).send({ error: "login failed" });
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.host_session) audit(req, "auth.logout", `host:${req.host_session.email}`);
    return reply.clearCookie(SESSION_COOKIE, cookieOpts).send({ ok: true });
  });

  // Signs this host out on every device and browser at once (a lost phone, a shared computer). Players are not affected.
  app.post("/auth/logout-all", { preHandler: requireHost }, async (req, reply) => {
    const email = req.host_session!.email;
    signOutEverywhere(email);
    audit(req, "auth.logout_all", `host:${email}`);
    return reply.clearCookie(SESSION_COOKIE, cookieOpts).send({ ok: true });
  });

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
      .prepare(`SELECT id, title, host_email AS owner, updated_at,
          EXISTS (SELECT 1 FROM drafts d WHERE d.trivia_id = trivias.id AND d.host_email = ? AND d.updated_at >= trivias.updated_at) AS has_draft
        FROM trivias ${all ? "" : "WHERE host_email = ?"} ORDER BY updated_at DESC`)
      .all(...(all ? [u.email] : [u.email, u.email]))
      .map((r: any) => ({ ...r, has_draft: !!r.has_draft }));
  });

  const full = (email: string) => (db.prepare("SELECT COUNT(*) AS n FROM trivias WHERE host_email = ?").get(email) as { n: number }).n >= MAX_TRIVIAS_PER_HOST;
  const tooMany = { error: `You already have ${MAX_TRIVIAS_PER_HOST} trivias, the most allowed. Delete some you no longer need first.` };

  app.post("/api/trivias", { preHandler: requireHost }, async (req, reply) => {
    if (full(req.host_session!.email)) return reply.code(429).send(tooMany);
    const body = trivia.safeParse(req.body);
    if (!body.success) return reply.code(400).send(describeProblems(req.body, body.error));
    const id = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO trivias (id, host_email, title, rounds, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id, req.host_session!.email, body.data.title, JSON.stringify(body.data.rounds), now, now, JSON.stringify(body.data.settings),
    );
    audit(req, "trivia.create", `trivia:${id}`, { title: body.data.title });
    return reply.code(201).send({ id });
  });

  type Row = { id: string; host_email: string; title: string; rounds: string; settings: string; updated_at: number };
  const load = (req: FastifyRequest): Row | undefined => {
    const u = req.host_session!;
    const row = db.prepare("SELECT * FROM trivias WHERE id = ?").get(idParam.parse(req.params).id) as Row | undefined;
    return row && (u.role === "admin" || row.host_email === u.email) ? row : undefined;
  };
  /** Every change to a trivia is on record. `others` marks an admin acting on somebody else's. */
  const touchOthers = (req: FastifyRequest, row: Row, action: string) => {
    const others = row.host_email !== req.host_session!.email;
    audit(req, action, `trivia:${row.id}`, { title: row.title, owner: row.host_email, ...(others ? { others: true } : {}) });
  };

  app.get("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const raw = JSON.parse(row.rounds);
    // Older trivias are folded into the one-question form on the way out, so the builder only ever sees the new shape.
    const upgraded = roundsSchema.safeParse(raw);
    return { id: row.id, title: row.title, owner: row.host_email, updated_at: row.updated_at, settings: settingsSchema.parse(JSON.parse(row.settings)), rounds: upgraded.success ? upgraded.data : raw };
  });

  app.put("/api/trivias/:id", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const body = trivia.safeParse(req.body);
    if (!body.success) return reply.code(400).send(describeProblems(req.body, body.error));
    // The builder says which saved version it started from. If the trivia has been saved since (another tab, another device,
    // an admin), refuse rather than overwrite that work unseen; the builder then asks. A request without `base` saves as before.
    const base = (req.body as { base?: unknown } | null)?.base;
    if (typeof base === "number" && base !== row.updated_at) {
      return reply.code(409).send({ error: "This trivia was saved somewhere else since you opened it.", conflict: true, updated_at: row.updated_at });
    }
    const now = Date.now();
    db.prepare("UPDATE trivias SET title = ?, rounds = ?, settings = ?, updated_at = ? WHERE id = ?").run(
      body.data.title, JSON.stringify(body.data.rounds), JSON.stringify(body.data.settings), now, row.id,
    );
    db.prepare("DELETE FROM drafts WHERE trivia_id = ? AND host_email = ?").run(row.id, req.host_session!.email); // saved, so the draft has done its job
    touchOthers(req, row, "trivia.edit");
    return { ok: true, updated_at: now };
  });

  // ---- drafts: a private copy of unsaved builder work, one per host per trivia. Saving the trivia clears it. ----
  app.get("/api/trivias/:id/draft", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const d = db.prepare("SELECT data, updated_at FROM drafts WHERE trivia_id = ? AND host_email = ?").get(row.id, req.host_session!.email) as { data: string; updated_at: number } | undefined;
    // A draft older than the saved version (it was saved from another device since) is out of date and not offered.
    if (!d || d.updated_at < row.updated_at) return { draft: null };
    return { draft: { at: d.updated_at, state: d.data } };
  });

  app.put("/api/trivias/:id/draft", { preHandler: requireHost, bodyLimit: DRAFT_REQUEST_LIMIT }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const body = draftBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid draft" });
    db.prepare("INSERT INTO drafts (trivia_id, host_email, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(trivia_id, host_email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(
      row.id, req.host_session!.email, body.data.state, Date.now(),
    );
    return { ok: true };
  });

  app.delete("/api/trivias/:id/draft", { preHandler: requireHost }, async (req, reply) => {
    const row = load(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    db.prepare("DELETE FROM drafts WHERE trivia_id = ? AND host_email = ?").run(row.id, req.host_session!.email);
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

  // ---- admin ----

  const started = Date.now();
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? version;
  } catch { /* the version is a nicety */ }
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

  app.get("/api/admin/overview", { preHandler: requireAdmin }, async () => {
    const lastLogin = new Map<string, number>();
    for (const r of db.prepare("SELECT actor, MAX(at) AS at FROM audit WHERE action = 'auth.login' GROUP BY actor").all() as { actor: string; at: number }[]) {
      lastLogin.set(norm(r.actor), Math.max(lastLogin.get(norm(r.actor)) ?? 0, r.at));
    }
    const owned = new Map<string, number>();
    for (const r of db.prepare("SELECT host_email, COUNT(*) AS n FROM trivias GROUP BY host_email").all() as { host_email: string; n: number }[]) {
      owned.set(norm(r.host_email), (owned.get(norm(r.host_email)) ?? 0) + r.n);
    }
    const games = store.list();
    const mine = (email: string) => games.filter((g) => norm(g.hostEmail) === email);
    return {
      status: {
        version, node: process.version, startedAt: started, schema: SCHEMA_VERSION,
        dbBytes: (db.pragma("page_count", { simple: true }) as number) * (db.pragma("page_size", { simple: true }) as number),
        memoryBytes: process.memoryUsage().rss,
        sessions: { active: games.filter((g) => g.phase !== "ended").length, finished: games.filter((g) => g.phase === "ended").length, ...store.counts },
        trivias: count("SELECT COUNT(*) AS n FROM trivias"),
        drafts: count("SELECT COUNT(*) AS n FROM drafts"),
        auditEntries: count("SELECT COUNT(*) AS n FROM audit"),
        liveConnections: streams.open,
        unreadableGames: store.unreadable,
        retention: { sessionsDays: cfg.GAME_RETENTION_DAYS, auditDays: cfg.AUDIT_RETENTION_DAYS },
        logLevel: cfg.LOG_LEVEL,
      },
      hosts: hosts.list().map((x) => ({
        ...x, lastLogin: lastLogin.get(x.email) ?? null, trivias: owned.get(x.email) ?? 0,
        sessions: mine(x.email).length, active: mine(x.email).filter((g) => g.phase !== "ended").length,
      })),
      // Kept for pages loaded before the audit log had its own address.
      audit: db.prepare("SELECT at, actor, action, target, detail FROM audit ORDER BY id DESC LIMIT 100").all(),
    };
  });

  const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().positive().optional(), q: z.string().max(100).optional() });
  const auditRows = (limit: number, before?: number, q?: string) => {
    const like = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return db.prepare(`SELECT id, at, actor, action, target, detail, ip FROM audit
        WHERE (? IS NULL OR id < ?) AND (? IS NULL OR actor LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')
        ORDER BY id DESC LIMIT ?`).all(before ?? null, before ?? null, like, like, like, like, like, limit) as { id: number; at: number; actor: string; action: string; target: string; detail: string | null; ip: string | null }[];
  };

  /** The audit log, newest first, a page at a time (`before` is the last id of the previous page), optionally filtered by a word. */
  app.get("/api/admin/audit", { preHandler: requireAdmin }, async (req) => {
    const { limit, before, q } = auditQuery.parse(req.query);
    const rows = auditRows(limit + 1, before, q);
    return { rows: rows.slice(0, limit), more: rows.length > limit };
  });

  /** The whole audit log as a spreadsheet file. Cells that a spreadsheet would run as a formula are defused. */
  app.get("/api/admin/audit.csv", { preHandler: requireAdmin }, async (req, reply) => {
    const cell = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = auditRows(100_000);
    audit(req, "admin.audit_export", "audit", { rows: rows.length });
    const lines = ["when,actor,action,target,detail,address", ...rows.map((r) => [new Date(r.at).toISOString(), r.actor, r.action, r.target, r.detail, r.ip].map(cell).join(","))];
    return reply.header("content-disposition", 'attachment; filename="trivia-audit.csv"').type("text/csv; charset=utf-8").send(lines.join("\r\n") + "\r\n");
  });

  /** Ends every session a host has, on every device. They can sign in again unless they are also taken off the hosts file. */
  app.post("/api/admin/hosts/signout", { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({ email: z.string().min(3).max(200) }).safeParse(req.body);
    if (!body.success || !hosts.roleOf(body.data.email)) return reply.code(404).send({ error: "no such host" });
    signOutEverywhere(body.data.email);
    audit(req, "admin.host_signout", `host:${norm(body.data.email)}`);
    return { ok: true };
  });

  registerSessionRoutes(app, ctx, load);
  registerPlayRoutes(app, ctx);
}
