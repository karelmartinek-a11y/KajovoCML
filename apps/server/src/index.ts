import { loadBootstrapConfig } from "./config.js";
import { createDb } from "./db.js";
import { buildApp } from "./app.js";
import { loadConfigFromDb } from "./domain/operational-config.js";

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
const app = await buildApp(config, db);

try {
  await app.listen({ port: config.PORT, host: "127.0.0.1" });
} catch (error) {
  app.log.error({ errorType: error instanceof Error ? error.name : typeof error }, "startup failed");
  process.exit(1);
}
