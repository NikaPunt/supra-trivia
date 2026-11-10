import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { buildApp } from "./app.js";
import { HostDirectory } from "./hosts.js";

const cfg = loadConfig();
const hosts = cfg.HOSTS_JSON ? HostDirectory.fromLists(JSON.parse(cfg.HOSTS_JSON)) : HostDirectory.fromFile(cfg.HOSTS_FILE);
const db = openDb(cfg.DB_PATH);
const app = await buildApp(cfg, db, hosts);

// Stop cleanly when asked to (docker stop, systemd, Ctrl-C): end the live streams, finish requests in flight, and close the
// database so its write-ahead log is folded back in. Every change is already on disk, so even a hard kill loses nothing.
let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 8000).unref(); // never hang: the supervisor's own kill comes at 10 seconds
  try {
    await app.close();
    db.close();
    process.exit(0);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));

await app.listen({ port: cfg.PORT, host: cfg.HOST });
