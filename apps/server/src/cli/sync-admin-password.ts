import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createDb } from "../db.js";
import { appendAudit } from "../domain/audit.js";
import { encryptMfaSecret } from "../security/secrets.js";

const config = loadConfig();
const db = createDb(config);
const pass = process.env.PASS;

try {
  const account = await db.query("select id from admin_account where username=$1", [config.ADMIN_BOOTSTRAP_USERNAME]);
  if (!account.rowCount) {
    await db.query("insert into admin_account(username, mfa_enabled) values ($1, false)", [config.ADMIN_BOOTSTRAP_USERNAME]);
  }
  const current = await db.query("select id from admin_account where username=$1", [config.ADMIN_BOOTSTRAP_USERNAME]);
  const accountId = current.rows[0].id;
  if (!pass) {
    await db.query("update admin_account set password_hash=null where id=$1", [accountId]);
    await appendAudit(db, { eventType: "admin.password.not_configured", actorType: "deployment", objectType: "admin_account", objectId: accountId, correlationId: randomUUID() });
    process.stderr.write("Admin password login is inactive because PASS is missing or empty.\n");
    process.exit(0);
  }
  const hash = await argon2.hash(pass, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const encryptedTotpSecret = config.ADMIN_TOTP_SECRET
    ? encryptMfaSecret(config.ADMIN_TOTP_SECRET, config.MFA_ENCRYPTION_KEY_BASE64)
    : null;
  await db.query(
    "update admin_account set password_hash=$1, password_changed_at=now(), mfa_enabled=$2, mfa_secret=$3 where id=$4",
    [hash, Boolean(config.ADMIN_TOTP_SECRET), encryptedTotpSecret, accountId]
  );
  await db.query("update admin_session set revoked_at=now() where account_id=$1 and revoked_at is null", [accountId]);
  await appendAudit(db, { eventType: "admin.password.synced", actorType: "deployment", objectType: "admin_account", objectId: accountId, correlationId: randomUUID() });
  if (config.ADMIN_TOTP_SECRET) {
    process.stderr.write("Admin password synchronized from PASS; MFA is configured; existing admin sessions revoked.\n");
  } else {
    process.stderr.write("Admin password synchronized from PASS; existing admin sessions revoked.\n");
  }
} finally {
  await db.end();
}
