import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Ctx } from "./context.js";
import { PLAYER_COOKIE, PLAYER_MAX_AGE, signPlayer, verifyPlayer } from "./auth.js";
import { GameError, joinPlayer, playerHistory, playerView, setWager, submit, submitTheme, type Game } from "./game.js";
import { openStream } from "./sessions.js";

const join = z.object({ code: z.string().min(3).max(10), nickname: z.string().min(1).max(40), pin: z.string().max(4).optional() });

/** A phone's own random id, used only so a team can see which guesses came from which phone. */
const deviceOf = (req: FastifyRequest): string | undefined => {
  const d = String(req.headers["x-device"] ?? "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(d) ? d : undefined;
};

/**
 * Joining is limited by what an abuser has to get wrong, not by how many people arrive. A whole bar shares one public address,
 * so successful joins are only held to a generous ceiling (they cost the server a PIN hash each), while refused ones (a wrong
 * room code, a wrong PIN, a taken name) are counted tightly, which is what guessing room codes or PINs looks like.
 */
export const JOIN_ATTEMPTS_PER_MINUTE = 150;
export const JOIN_FAILURES_PER_MINUTE = 30;
const FAIL_WINDOW_MS = 60_000;

export function registerPlayRoutes(app: FastifyInstance, ctx: Ctx) {
  const { store, cfg, cookieOpts } = ctx;
  const failures = new Map<string, number[]>();
  const recent = (ip: string): number[] => {
    const now = Date.now();
    const list = (failures.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    if (list.length) failures.set(ip, list); else failures.delete(ip);
    return list;
  };
  const miss = (ip: string) => { const l = recent(ip); l.push(Date.now()); failures.set(ip, l); };
  const sweep = setInterval(() => { for (const ip of [...failures.keys()]) recent(ip); }, FAIL_WINDOW_MS);
  sweep.unref();
  app.addHook("onClose", async () => clearInterval(sweep));

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

  app.post("/api/join", { config: { rateLimit: { max: JOIN_ATTEMPTS_PER_MINUTE, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (recent(req.ip).length >= JOIN_FAILURES_PER_MINUTE) return reply.code(429).send({ error: "too many failed attempts from this network. Wait a minute and try again" });
    const body = join.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "enter a room code and a nickname" });
    const g = store.getByCode(body.data.code);
    if (!g) { miss(req.ip); return reply.code(404).send({ error: "no active session with that code" }); }
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
      if (e instanceof GameError && e.status !== 400) miss(req.ip); // a typo in a name is not guessing; a wrong PIN or a taken name is
      req.log.warn({ code: g.code, player: body.data.nickname.slice(0, 24), reason: (e as Error).message }, "join refused");
      return fail(reply, e);
    }
  });

  /**
   * Is this phone already at a table? The home page asks this of every visitor, so a stranger gets a plain "no" (200), never a 401:
   * a proxy-level ban list such as fail2ban counts repeated 401s, and every new player loading the home page would add one.
   */
  app.get("/api/play/where", async (req) => {
    const t = await verifyPlayer(cfg, req.cookies[PLAYER_COOKIE]);
    const g = t && store.get(t.sid);
    const p = g && g.players.find((x) => x.id === t.pid);
    if (!t || !g || !p || p.kicked) return { table: null };
    return { table: { me: p.nickname, code: g.code, phase: g.phase } };
  });

  app.get("/api/play/state", async (req, reply) => {
    const s = await me(req, reply);
    return s ? playerView(s.g, s.pid, deviceOf(req)) : undefined;
  });

  /** This team's own finished questions, for its "My answers" tab. */
  app.get("/api/play/history", async (req, reply) => {
    const s = await me(req, reply);
    return s ? playerHistory(s.g, s.pid, store.records(s.g.id)) : undefined;
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
