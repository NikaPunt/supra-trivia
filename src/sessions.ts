import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Ctx } from "./context.js";
import { GameError, act, deckView, hostView, items, newGame, type Game } from "./game.js";
import { roundsSchema, settingsSchema } from "./modules/index.js";

const id = z.object({ id: z.uuid() });
const actionSchema = z.union([
  z.object({ action: z.enum(["begin", "close", "reopen", "reveal", "next", "end", "theme_reveal", "pause", "resume", "showclue", "lock", "unlock"]) }),
  z.object({ action: z.enum(["kick", "letin"]), playerId: z.uuid() }),
  z.object({ action: z.literal("extend"), seconds: z.number().int().min(5).max(600).optional() }),
  z.object({ action: z.literal("review"), answerId: z.uuid(), points: z.number().min(-1000).max(1000).multipleOf(0.5) }),
  z.object({ action: z.literal("theme_review"), guessId: z.uuid(), points: z.number().min(0).max(1000).multipleOf(0.5) }),
]);
const MAX_ACTIVE_PER_HOST = 5;
const MILESTONES = new Set(["begin", "end", "kick", "lock", "unlock", "letin", "theme_reveal"]);

const sessionSettings = (raw: string) => {
  const s = settingsSchema.parse(JSON.parse(raw));
  return { maxGuesses: s.maxGuesses, timeLimit: s.timeLimit, theme: s.theme };
};

/**
 * Server-sent events: the client is told something changed and refetches its own view.
 * `viewer` names who is watching ("p:<player id>" or "h:<host email>") so connections can be capped per viewer.
 */
export function openStream(req: FastifyRequest, reply: FastifyReply, ctx: Ctx, gameId: string, viewer: string) {
  // The page falls back to checking every few seconds when it has no stream, so refusing one costs nothing but chatter.
  if (!ctx.streams.hasRoom(gameId, viewer)) return reply.code(429).send({ error: "too many live connections" });
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no", // keep Nginx Proxy Manager from buffering the stream
    "x-content-type-options": "nosniff",
  });
  res.write("retry: 3000\n\nevent: ping\ndata: 1\n\n"); // an immediate ping lets the page confirm the stream really delivers
  const changed = () => res.write("event: changed\ndata: 1\n\n");
  // A named event (not a comment) so the page can see the stream is alive and fall back to polling if it is not.
  const beat = setInterval(() => res.write("event: ping\ndata: 1\n\n"), 15_000);
  ctx.store.bus.on(gameId, changed);
  const forget = ctx.streams.add(gameId, viewer, res);
  const done = () => {
    clearInterval(beat);
    ctx.store.bus.off(gameId, changed);
    forget();
  };
  req.raw.on("close", done);
  res.on("close", done);
  res.on("error", done);
}

export function registerSessionRoutes(
  app: FastifyInstance,
  ctx: Ctx,
  loadTrivia: (req: FastifyRequest) => { id: string; host_email: string; title: string; rounds: string; settings: string } | undefined,
) {
  const { store, requireHost, requireAdmin, audit } = ctx;

  /** Hosts reach their own sessions; admins reach all. Anyone else gets a 404 so session ids can't be probed. */
  const manage = (req: FastifyRequest, reply: FastifyReply): Game | null => {
    const g = store.get(id.parse(req.params).id);
    const u = req.host_session!;
    if (!g || (u.role !== "admin" && g.hostEmail !== u.email)) {
      reply.code(404).send({ error: "not found" });
      return null;
    }
    return g;
  };

  app.post("/api/trivias/:id/sessions", { preHandler: requireHost }, async (req, reply) => {
    const row = loadTrivia(req);
    if (!row) return reply.code(404).send({ error: "not found" });
    const u = req.host_session!;
    if (store.activeCountFor(u.email) >= MAX_ACTIVE_PER_HOST) return reply.code(429).send({ error: `at most ${MAX_ACTIVE_PER_HOST} active sessions` });
    try {
      const g = newGame({ hostEmail: u.email, triviaId: row.id, title: row.title, rounds: roundsSchema.parse(JSON.parse(row.rounds)), code: store.newCode(), ...sessionSettings(row.settings) });
      store.save(g);
      audit(req, "session.create", `session:${g.id}`, { code: g.code, title: g.title, trivia: row.id, ...(row.host_email !== u.email ? { owner: row.host_email, others: true } : {}) });
      return reply.code(201).send({ id: g.id, code: g.code });
    } catch (e) {
      if (e instanceof GameError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.get("/api/sessions", { preHandler: requireHost }, async (req) => {
    const u = req.host_session!;
    const all = u.role === "admin" && (req.query as any).all === "1";
    return store
      .list()
      .filter((g) => all || g.hostEmail === u.email)
      .map((g) => ({ id: g.id, code: g.code, title: g.title, phase: g.phase, host: g.hostEmail, players: g.players, createdAt: g.createdAt }));
  });

  app.get("/api/sessions/:id", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    return g ? { ...hostView(g), you: req.host_session!.email } : undefined;
  });

  app.get("/api/sessions/:id/deck", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    return g ? deckView(g) : undefined;
  });

  app.get("/api/sessions/:id/events", { preHandler: requireHost, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const g = manage(req, reply);
    if (g) return openStream(req, reply, ctx, g.id, `h:${req.host_session!.email}`);
  });

  app.post("/api/sessions/:id/action", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    if (!g) return;
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid action" });
    try {
      act(g, parsed.data);
    } catch (e) {
      if (e instanceof GameError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    store.save(g);
    if (parsed.data.action === "kick") ctx.streams.closeViewer(g.id, `p:${parsed.data.playerId}`);
    const u = req.host_session!;
    const a = parsed.data;
    const others = u.email !== g.hostEmail;
    // On record: the steps that shape a session (start, end, who is in or out, the theme going public), and anything at all
    // an admin does in somebody else's. Marking answers is not here; each mark is in the session's own record.
    if (others || MILESTONES.has(a.action)) {
      const player = "playerId" in a ? g.players.find((p) => p.id === a.playerId)?.nickname : undefined;
      audit(req, `session.${a.action}`, `session:${g.id}`, {
        code: g.code, host: g.hostEmail, ...(player ? { player } : {}), ...(others ? { others: true } : {}),
        ...(a.action === "end" || g.phase === "ended" ? { players: g.players.filter((p) => !p.kicked).length, questions: g.history.length } : {}),
      });
    }
    return { ok: true };
  });

  /**
   * Everything kept about a session: who played, the final scores, and for every finished question what each team answered
   * and earned. The owner and admins only. Sessions played before records were kept have scores but no answers.
   */
  app.get("/api/sessions/:id/record", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    if (!g) return;
    const u = req.host_session!;
    if (u.email !== g.hostEmail) audit(req, "session.record_view", `session:${g.id}`, { code: g.code, host: g.hostEmail, others: true });
    const v = hostView(g);
    const name = new Map(g.players.map((p) => [p.id, p.nickname]));
    const all = items(g);
    return {
      id: g.id, code: g.code, title: g.title, host: g.hostEmail, phase: g.phase, createdAt: g.createdAt, endedAt: g.endedAt,
      questions: all.length,
      players: g.players.map((p) => ({ nickname: p.nickname, joinedAt: p.joinedAt, removed: p.kicked })),
      leaderboard: v.leaderboard.map((r) => ({ nickname: r.nickname, points: r.points })),
      themeBonuses: g.themeRevealed ? Object.fromEntries(Object.entries(g.themeBonus).map(([pid, p]) => [name.get(pid) ?? "?", p])) : {},
      // Points per team for each finished question: kept for every session, old and new.
      history: g.history.map((h) => ({ number: h.cursor + 1, round: all[h.cursor]?.roundTitle ?? "", type: h.type, points: Object.fromEntries(Object.entries(h.points).map(([pid, p]) => [name.get(pid) ?? "?", p])) })),
      records: store.records(g.id),
    };
  });
}
