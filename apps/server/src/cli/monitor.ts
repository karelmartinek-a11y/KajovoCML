import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { MonitoringScheduler } from "../onboarding/monitoring.js";

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
if (!config.MONITOR_ENABLED) throw new Error("MONITOR_ENABLED must be true for the monitor process");
const monitor = new MonitoringScheduler(db, config);
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
  await monitor.run(controller.signal);
} finally {
  await db.end();
}
