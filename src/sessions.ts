import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Ctx } from "./context.js";
import { GameError, act, deckView, hostView, newGame, type Game } from "./game.js";
import { roundsSchema, settingsSchema } from "./modules/index.js";

const id = z.object({ id: z.uuid() });
const actionSchema = z.union([
  z.object({ action: z.enum(["begin", "close", "reopen", "reveal", "next", "end", "theme_reveal"]) }),
  z.object({ action: z.literal("kick"), playerId: z.uuid() }),
  z.object({ action: z.literal("review"), answerId: z.uuid(), points: z.number().min(-1000).max(1000).multipleOf(0.5) }),
  z.object({ action: z.literal("theme_review"), guessId: z.uuid(), points: z.number().min(0).max(1000).multipleOf(0.5) }),
]);
const MAX_ACTIVE_PER_HOST = 5;

const sessionSettings = (raw: string) => {
  const s = settingsSchema.parse(JSON.parse(raw));
  return { maxGuesses: s.maxGuesses, theme: s.theme };
};

/** Server-sent events: the client is told something changed and refetches its own view. */
export function openStream(req: FastifyRequest, reply: FastifyReply, ctx: Ctx, gameId: string) {
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
  req.raw.on("close", () => {
    clearInterval(beat);
    ctx.store.bus.off(gameId, changed);
  });
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
      .map((g) => ({ id: g.id, code: g.code, title: g.title, phase: g.phase, host: g.hostEmail, players: g.players.length, createdAt: g.createdAt }));
  });

  app.get("/api/sessions/:id", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    return g ? { ...hostView(g), you: req.host_session!.email } : undefined;
  });

  app.get("/api/sessions/:id/deck", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    return g ? deckView(g) : undefined;
  });

  app.get("/api/sessions/:id/events", { preHandler: requireHost }, async (req, reply) => {
    const g = manage(req, reply);
    if (g) openStream(req, reply, ctx, g.id);
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
    const u = req.host_session!;
    if (parsed.data.action === "end" || u.email !== g.hostEmail) audit(u.email, `session.${parsed.data.action}`, `session:${g.id}`, { code: g.code, host: g.hostEmail });
    return { ok: true };
  });

  // ---- admin ----

  app.get("/api/admin/overview", { preHandler: requireAdmin }, async () => ({
    hosts: ctx.hosts.list(),
    audit: ctx.db.prepare("SELECT at, actor, action, target, detail FROM audit ORDER BY id DESC LIMIT 100").all(),
  }));
}
