import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import {
  createSecret,
  deleteSecret,
  setSecretStatus
} from "./secret-manager.js";
import {
  generationOpenAiReadiness,
  generationOpenAiReady,
  reconcileGenerationOpenAiReadiness
} from "./generation.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";
let db: Db;
let config: AppConfig;
let ownerId = "";

describe.skipIf(!enabled)("canonical OpenAI Secret Manager readiness", () => {
  beforeAll(async () => {
    config = loadConfig(process.env);
    db = createDb(config);
    const owner = await db.query("select id from admin_account where role='OWNER' and active=true order by created_at limit 1");
    if (!owner.rowCount) throw new Error("generation_openai_readiness_owner_missing");
    ownerId = String(owner.rows[0].id);
    // The CI database is dedicated to this suite; preserve no canonical record between runs.
    await db.query("delete from secret_record where stable_name='OPENAI_API_KEY'");
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("delete from secret_record where stable_name='OPENAI_API_KEY'");
    await db.end();
  });

  it("reuses the existing canonical secret, reconciles only its direct PLATFORM grant, and fails closed for unusable states", async () => {
    expect((await generationOpenAiReadiness(db, config)).reason).toBe("MISSING");
    const secret = await createSecret(db, config, ownerId, randomUUID(), {
      stableName: "OPENAI_API_KEY",
      displayName: "OpenAI test credential",
      description: "Non-provider credential used only for Secret Manager integration verification.",
      value: "non-provider-test-credential",
      ownerKind: "PLATFORM"
    });

    const withoutGrant = await generationOpenAiReadiness(db, config);
    expect(withoutGrant).toMatchObject({ ready: false, reason: "PLATFORM_GRANT_MISSING", secretExists: true, activeVersion: true, platformGrant: false, canonicalResolve: "NOT_ATTEMPTED" });

    const reconciled = await reconcileGenerationOpenAiReadiness(db, config, ownerId, randomUUID());
    expect(reconciled).toMatchObject({ ready: true, reason: "READY", secretExists: true, secretStatus: "ACTIVE", activeVersion: true, platformGrant: true, canonicalResolve: "PASS" });
    expect(await generationOpenAiReady(db, config)).toBe(true);
    expect(Number((await db.query("select count(*)::int as count from secret_record where stable_name='OPENAI_API_KEY'")).rows[0].count)).toBe(1);

    const disabled = await setSecretStatus(db, ownerId, randomUUID(), secret.id, secret.lockVersion, "DISABLED");
    expect((await generationOpenAiReadiness(db, config)).reason).toBe("INACTIVE");
    const active = await setSecretStatus(db, ownerId, randomUUID(), secret.id, disabled.lockVersion, "ACTIVE");

    await db.query("update secret_record set active_version_id=null where id=$1", [secret.id]);
    expect((await generationOpenAiReadiness(db, config)).reason).toBe("ACTIVE_VERSION_MISSING");
    const version = await db.query("select id from secret_version where secret_id=$1 order by version_number desc limit 1", [secret.id]);
    await db.query("update secret_record set active_version_id=$2 where id=$1", [secret.id, version.rows[0].id]);

    await deleteSecret(db, ownerId, randomUUID(), secret.id, active.lockVersion);
    expect((await generationOpenAiReadiness(db, config)).reason).toBe("DELETED");
  });
});
