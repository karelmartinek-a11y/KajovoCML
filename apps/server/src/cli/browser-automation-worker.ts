import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { processNextBrowserAutomationRun } from "../domain/browser-automation.js";
import { recordPlatformWorkerHeartbeat, runWithPeriodicPlatformWorkerHeartbeat } from "../onboarding/platform-worker-heartbeat.js";

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
const workerId = `browser-automation-${randomUUID()}`;
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());

try {
  await recordPlatformWorkerHeartbeat(db, { workerKind: "BROWSER_AUTOMATION", workerId, buildId: config.BUILD_ID, completed: false });
  while (!controller.signal.aborted) {
    let worked = false;
    try {
      worked = await runWithPeriodicPlatformWorkerHeartbeat(
        db,
        { workerKind: "BROWSER_AUTOMATION", workerId, buildId: config.BUILD_ID },
        () => processNextBrowserAutomationRun(db, config, workerId)
      );
      await recordPlatformWorkerHeartbeat(db, { workerKind: "BROWSER_AUTOMATION", workerId, buildId: config.BUILD_ID, completed: worked });
    } catch (error) {
      await recordPlatformWorkerHeartbeat(db, {
        workerKind: "BROWSER_AUTOMATION", workerId, buildId: config.BUILD_ID, completed: false,
        error: error instanceof Error ? error.message : "browser_automation_worker_failed"
      });
      throw error;
    }
    if (!worked) await new Promise((resolve) => setTimeout(resolve, config.GENERATION_WORKER_INTERVAL_MS));
  }
} finally {
  await db.end();
}
