import { z } from "zod";

const schema = z.object({
  BASE_URL: z.url().transform((u) => u.replace(/\/$/, "")),
  PORT: z.coerce.number().int().default(3000),
  DB_PATH: z.string().default("./data/trivia.db"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  HOSTS_FILE: z.string().default("./config/hosts.json"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
