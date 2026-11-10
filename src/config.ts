import { z } from "zod";

const schema = z.object({
  BASE_URL: z.url().transform((u) => u.replace(/\/$/, "")),
  PORT: z.coerce.number().int().default(3000),
  DB_PATH: z.string().default("./data/trivia.db"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  /** Address to listen on. Use 127.0.0.1 when a reverse proxy runs on the same machine. */
  HOST: z.string().default("0.0.0.0"),
  /** Give every host a copy of the sample trivia the first time they open their dashboard. */
  SEED_SAMPLE: z.string().default("true").transform((v) => !/^(false|0|no|off)$/i.test(v.trim())),
  HOSTS_FILE: z.string().default("./config/hosts.json"),
  /**
   * Which senders are reverse proxies whose X-Forwarded-For is believed, as addresses or ranges separated by commas.
   * The visitor's address is the first one, reading from the app outwards, that is not a proxy, so a visitor cannot make one up.
   * The default trusts private addresses, which is where a proxy on the same machine or Docker network lives. Narrow it to
   * your proxy's own range ("172.18.0.0/16") if untrusted devices share the private network. "false" trusts nobody.
   */
  TRUST_PROXY: z.string().default("loopback, linklocal, uniquelocal").transform((v, ctx) => {
    const t = v.trim();
    if (/^(false|no|off|0)$/i.test(t)) return false;
    if (/^(true|yes|on)$/i.test(t)) return true; // believes any sender: only safe when the proxy overwrites the header
    if (/^\d+$/.test(t)) {
      ctx.addIssue({ code: "custom", message: "TRUST_PROXY takes proxy addresses or ranges, not a hop count" });
      return z.NEVER;
    }
    return t;
  }),
  /** How much the app writes to its log: debug adds every page refresh and poll; info is one line per change and per problem. */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Audit log entries older than this many days are deleted. 0 keeps them forever. */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  /** Finished sessions older than this many days are deleted. 0 keeps them forever. */
  GAME_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  /** The same content as the hosts file, as inline JSON, for platforms without files. Takes precedence; restart to change. */
  HOSTS_JSON: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
