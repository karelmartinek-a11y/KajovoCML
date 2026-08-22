import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb, tx } from "../db.js";
import { closeAlert, deliverNextAlert, raiseAlert } from "../domain/alerts.js";
import { loadConfigFromDb } from "../domain/operational-config.js";

const action = process.argv[2];
if (action !== "failed" && action !== "recovered") {
  throw new Error("canonical_tls_renewal_alert_action_invalid");
}

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
const correlationId = randomUUID();

try {
  if (action === "failed") {
    await tx(db, async (client) => raiseAlert(client, {
      severity: "CRITICAL",
      alertType: "tls.canonical_renewal_failed",
      title: "KCML canonical TLS renewal failed",
      detail: {
        runbook: "docs/runbooks/deployment.md#canonical-tls-renewal",
        automaticRecovery: "previous_valid_certificate_retained",
        retry: "bounded_certbot_retry"
      },
      correlationId
    }));
    // A renewal failure must become operationally visible now; delivery errors
    // remain durable retries in the canonical alert ledger.
    await deliverNextAlert(db, config);
    await deliverNextAlert(db, config);
    process.stdout.write("canonical-tls-renewal-alert:failed:queued\\n");
  } else {
    await tx(db, async (client) => closeAlert(client, {
      alertType: "tls.canonical_renewal_failed",
      reason: "canonical_tls_renewal_verified",
      correlationId
    }));
    process.stdout.write("canonical-tls-renewal-alert:recovered\\n");
  }
} finally {
  await db.end();
}
