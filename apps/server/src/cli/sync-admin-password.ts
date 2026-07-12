import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { createDb } from "../db.js";
import { appendAudit } from "../domain/audit.js";

const config = loadConfig();
const db = createDb(config);
const pass = process.env.PASS;

try {
  const account = await db.query("select id from admin_account where username='karmar78'");
  if (!account.rowCount) {
    await db.query("insert into admin_account(username, mfa_enabled) values ('karmar78', false)");
  }
  const current = await db.query("select id from admin_account where username='karmar78'");
  const accountId = current.rows[0].id;
  if (!pass) {
    await db.query("update admin_account set password_hash=null where id=$1", [accountId]);
    await appendAudit(db, { eventType: "admin.password.not_configured", actorType: "deployment", objectType: "admin_account", objectId: accountId, correlationId: randomUUID() });
    process.stderr.write("Admin password login is inactive because PASS is missing or empty.\n");
    process.exit(0);
  }
  const hash = await argon2.hash(pass, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  await db.query(
    "update admin_account set password_hash=$1, password_changed_at=now(), mfa_enabled=$2, mfa_secret=$3 where id=$4",
    [hash, Boolean(config.ADMIN_TOTP_SECRET), config.ADMIN_TOTP_SECRET ?? null, accountId]
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
