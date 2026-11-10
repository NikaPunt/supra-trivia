import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Ctx } from "./context.js";
import { PLAYER_COOKIE, PLAYER_MAX_AGE, signPlayer, verifyPlayer } from "./auth.js";
import { GameError, joinPlayer, playerView, setWager, submit, submitTheme, type Game } from "./game.js";
import { openStream } from "./sessions.js";

const join = z.object({ code: z.string().min(3).max(10), nickname: z.string().min(1).max(40), pin: z.string().max(4).optional() });

/** A phone's own random id, used only so a team can see which guesses came from which phone. */
const deviceOf = (req: FastifyRequest): string | undefined => {
  const d = String(req.headers["x-device"] ?? "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(d) ? d : undefined;
};

export function registerPlayRoutes(app: FastifyInstance, ctx: Ctx) {
  const { store, cfg, cookieOpts } = ctx;

  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof GameError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  /** Resolves the player from their cookie, or answers 401/403 and returns null. */
  const me = async (req: FastifyRequest, reply: FastifyReply): Promise<{ g: Game; pid: string } | null> => {
    const t = await verifyPlayer(cfg, req.cookies[PLAYER_COOKIE]);
    const g = t && store.get(t.sid);
    const p = g && g.players.find((x) => x.id === t.pid);
    if (!t || !g || !p || p.kicked) {
      reply.clearCookie(PLAYER_COOKIE, cookieOpts).code(401).send({ error: "not in a session" });
      return null;
    }
    req.who = `player:${p.nickname}@${g.code}`;
    return { g, pid: p.id };
  };

  app.post("/api/join", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = join.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "enter a room code and a nickname" });
    const g = store.getByCode(body.data.code);
    if (!g) return reply.code(404).send({ error: "no active session with that code" });
    try {
      const { player, rejoined } = joinPlayer(g, body.data.nickname, body.data.pin);
      store.save(g);
      req.who = `player:${player.nickname}@${g.code}`;
      req.log.info({ code: g.code, player: player.nickname, rejoined }, "joined");
      const token = await signPlayer(cfg, { sid: g.id, pid: player.id });
      return reply.setCookie(PLAYER_COOKIE, token, { ...cookieOpts, maxAge: PLAYER_MAX_AGE }).send({ ok: true });
    } catch (e) {
      // Wrong PINs and locked names change the game too (the count, the lock), and are what an owner looks for after trouble.
      store.save(g);
      req.log.warn({ code: g.code, player: body.data.nickname.slice(0, 24), reason: (e as Error).message }, "join refused");
      return fail(reply, e);
    }
  });

  app.get("/api/play/state", async (req, reply) => {
    const s = await me(req, reply);
    return s ? playerView(s.g, s.pid, deviceOf(req)) : undefined;
  });

  app.post("/api/play/answer", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await me(req, reply);
    if (!s) return;
    try {
      submit(s.g, s.pid, (req.body as any)?.value, deviceOf(req));
      store.save(s.g);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/play/wager", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await me(req, reply);
    if (!s) return;
    try {
      setWager(s.g, s.pid, (req.body as any)?.value);
      store.save(s.g);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/play/theme", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await me(req, reply);
    if (!s) return;
    try {
      submitTheme(s.g, s.pid, String((req.body as any)?.guess ?? ""), deviceOf(req));
      store.save(s.g);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/api/play/events", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await me(req, reply);
    if (s) return openStream(req, reply, ctx, s.g.id, `p:${s.pid}`);
  });
}
