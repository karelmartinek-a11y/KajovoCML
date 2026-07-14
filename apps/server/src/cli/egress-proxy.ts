import { loadConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { buildEgressProxy, listenEgressProxy } from "../onboarding/egress-proxy.js";

const bootstrapConfig = loadConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
const server = await buildEgressProxy(db, config);
await listenEgressProxy(server, config.EGRESS_PROXY_SOCKET_PATH);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
