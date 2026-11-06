import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { HostDirectory } from "./hosts.js";
import type { GameStore } from "./store.js";

export interface Ctx {
  cfg: Config;
  db: Db;
  hosts: HostDirectory;
  store: GameStore;
  cookieOpts: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string };
  requireHost: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Records privileged actions so the owner can see what admins (and hosts) did. */
  audit: (actor: string, action: string, target: string, detail?: unknown) => void;
}
