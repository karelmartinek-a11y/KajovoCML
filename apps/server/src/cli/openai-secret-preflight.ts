import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { generationOpenAiReadiness, reconcileGenerationOpenAiReadiness } from "../domain/generation.js";

function yesNo(value: boolean): "yes" | "no" { return value ? "yes" : "no"; }

async function main(): Promise<void> {
  const config = loadBootstrapConfig();
  const db = createDb(config);
  try {
    let readiness = await generationOpenAiReadiness(db, config);
    // The sole permitted remediation is an idempotent direct grant to the existing
    // canonical secret.  No credential value is accepted, read to stdout, created, or rotated.
    if (readiness.reason === "PLATFORM_GRANT_MISSING") {
      const owner = await db.query("select id from admin_account where role='OWNER' and active=true order by created_at limit 1");
      if (!owner.rowCount) throw new Error("openai_secret_owner_unavailable_for_grant_reconciliation");
      readiness = await reconcileGenerationOpenAiReadiness(db, config, String(owner.rows[0].id), randomUUID());
    }
    process.stdout.write(`openai-secret:stable-name=${readiness.stableName}\n`);
    process.stdout.write(`openai-secret:exists=${yesNo(readiness.secretExists)}\n`);
    process.stdout.write(`openai-secret:status=${readiness.secretStatus ?? "NONE"}\n`);
    process.stdout.write(`openai-secret:active-version=${yesNo(readiness.activeVersion)}\n`);
    process.stdout.write(`openai-secret:platform-principal=${readiness.platformPrincipal?.publicId ?? "UNAVAILABLE"}\n`);
    process.stdout.write(`openai-secret:platform-grant=${yesNo(readiness.platformGrant)}\n`);
    process.stdout.write(`openai-secret:canonical-resolve=${readiness.canonicalResolve}\n`);
    process.stdout.write(`openai-secret:generation-ready=${yesNo(readiness.ready)}\n`);
    if (!readiness.ready) throw new Error(`openai_secret_preflight_failed:${readiness.reason}`);
  } finally {
    await db.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "openai_secret_preflight_failed";
  process.stderr.write(`openai-secret:FAIL:${message.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 240)}\n`);
  process.exitCode = 1;
});
