import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { HostDirectory } from "./hosts.js";
import type { GameStore } from "./store.js";
import type { Streams } from "./streams.js";

export interface Ctx {
  cfg: Config;
  db: Db;
  hosts: HostDirectory;
  store: GameStore;
  streams: Streams;
  cookieOpts: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string };
  requireHost: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /**
   * Puts an action on the audit log: who (the signed-in host, unless `actor` says otherwise), what, on what, and from which address.
   * Everything a host or admin changes goes here; what players do goes in the game's own record.
   */
  audit: (req: FastifyRequest | null, action: string, target: string, detail?: unknown, actor?: string) => void;
}
