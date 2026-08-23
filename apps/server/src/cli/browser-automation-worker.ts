import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { processNextBrowserAutomationRun } from "../domain/browser-automation.js";

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
const workerId = `browser-automation-${randomUUID()}`;
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());

try {
  while (!controller.signal.aborted) {
    const worked = await processNextBrowserAutomationRun(db, config, workerId);
    if (!worked) await new Promise((resolve) => setTimeout(resolve, config.GENERATION_WORKER_INTERVAL_MS));
  }
} finally {
  await db.end();
}
