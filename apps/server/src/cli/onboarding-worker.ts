import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { OnboardingWorker } from "../onboarding/worker.js";

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
if (!config.ONBOARDING_WORKER_ENABLED) throw new Error("ONBOARDING_WORKER_ENABLED must be true for the worker process");
const worker = new OnboardingWorker(db, config);
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
  await worker.run(controller.signal);
} finally {
  await db.end();
}
