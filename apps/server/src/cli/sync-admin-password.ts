import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { tx } from "../db.js";
import {
  requireDeploymentManagedAdminPassword,
  syncDeploymentManagedAdmin,
  verifyDeploymentManagedAdminPassword
} from "../domain/deployment-managed-admin.js";
import { loadConfigFromDb } from "../domain/operational-config.js";

const bootstrapConfig = loadBootstrapConfig();
const db = createDb(bootstrapConfig);
const config = await loadConfigFromDb(db, bootstrapConfig);
const pass = process.env.PASS;
const rotatePassword = process.env.KCML_ADMIN_PASSWORD_ROTATION_CONFIRM === "ROTATE_KCML_OWNER_PASSWORD";

try {
  const password = requireDeploymentManagedAdminPassword(pass);
  const syncResult = await tx(db, async (client) => {
    return syncDeploymentManagedAdmin(client, {
      username: config.ADMIN_BOOTSTRAP_USERNAME,
      password,
      mfaEncryptionKey: config.MFA_ENCRYPTION_KEY_BASE64,
      configuredTotpSecret: config.ADMIN_TOTP_SECRET,
      rotatePassword,
      actorType: "deployment",
      eventType: "admin.password.reconciled",
      correlationId: randomUUID()
    });
  });
  if (syncResult.passwordMatchesInput) {
    await tx(db, async (client) => {
      await verifyDeploymentManagedAdminPassword(client, syncResult.accountId, password, "deployment", randomUUID());
    });
  }
  process.stdout.write(`${JSON.stringify(syncResult)}\n`);
  process.stderr.write(
    `Deployment-managed admin reconciled; password source=${syncResult.passwordSource}; ` +
    `password matches PASS=${syncResult.passwordMatchesInput}; MFA ${syncResult.mfaEnabled ? "enabled" : "disabled"} ` +
    `(source=${syncResult.mfaSource}).\n`
  );
} finally {
  await db.end();
}
