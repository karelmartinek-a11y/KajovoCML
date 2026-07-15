import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { createDb, tx } from "../db.js";
import { appendAudit } from "../domain/audit.js";
import { decryptMfaSecret, encryptMfaSecret } from "../security/secrets.js";

export async function migrateLegacyMfaSecrets(options: {
  dryRun?: boolean;
} = {}): Promise<{ migrated: number; skipped: number }> {
  const config = loadConfig();
  const db = createDb(config);
  try {
    return await tx(db, async (client) => {
      const legacy = await client.query(
        `select id, username, mfa_secret
           from admin_account
          where mfa_enabled = true
            and mfa_secret is not null
            and mfa_secret <> ''
            and mfa_secret not like 'enc:v1:%'
          for update`
      );
      let migrated = 0;
      for (const row of legacy.rows as Array<{ id: string; username: string; mfa_secret: string }>) {
        const encrypted = encryptMfaSecret(String(row.mfa_secret), config.MFA_ENCRYPTION_KEY_BASE64);
        const roundTrip = decryptMfaSecret(encrypted, config.MFA_ENCRYPTION_KEY_BASE64);
        if (roundTrip !== String(row.mfa_secret)) throw new Error("mfa_secret_round_trip_failed");
        if (!options.dryRun) {
          await client.query("update admin_account set mfa_secret=$2 where id=$1", [row.id, encrypted]);
        }
        await appendAudit(client, {
          eventType: "admin.mfa_secret.migrated",
          actorType: "deployment",
          actorId: "mfa-secret-migration",
          objectType: "admin_account",
          objectId: row.id,
          after: {
            username: row.username,
            mode: options.dryRun ? "dry_run" : "applied",
            format: "enc:v1"
          },
          correlationId: randomUUID()
        });
        migrated += 1;
      }
      return { migrated, skipped: 0 };
    });
  } finally {
    await db.end();
  }
}

const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateLegacyMfaSecrets({ dryRun }).then((result) => {
    process.stdout.write(`mfa-secret-migration:${dryRun ? "DRY_RUN" : "APPLIED"} migrated=${result.migrated}\n`);
  }).catch((error) => {
    process.stderr.write(`mfa-secret-migration:FAIL error=${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
