import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { buildApp } from "./app.js";
import { HostDirectory } from "./hosts.js";

const cfg = loadConfig();
const hosts = cfg.HOSTS_JSON ? HostDirectory.fromLists(JSON.parse(cfg.HOSTS_JSON)) : HostDirectory.fromFile(cfg.HOSTS_FILE);
const app = await buildApp(cfg, openDb(cfg.DB_PATH), hosts);
await app.listen({ port: cfg.PORT, host: cfg.HOST });
