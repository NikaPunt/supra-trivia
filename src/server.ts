import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { buildApp } from "./app.js";
import { HostDirectory } from "./hosts.js";

const cfg = loadConfig();
const app = await buildApp(cfg, openDb(cfg.DB_PATH), HostDirectory.fromFile(cfg.HOSTS_FILE));
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
