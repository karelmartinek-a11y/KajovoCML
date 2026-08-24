import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db.js";
import {
  browserAutomationCanonicalJson,
  browserAutomationDigest,
  createBrowserAutomationRun,
  preflightBrowserAutomation,
  requestBrowserAutomationCancel,
  setBrowserAutomationEnabled
} from "./browser-automation.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";
let db: Db;
let ownerId = "";
const definitionIds: string[] = [];

describe.skipIf(!enabled)("browser automation queue persistence", () => {
  beforeAll(async () => {
    db = createDb({ DATABASE_URL: process.env.DATABASE_URL! });
    const owner = await db.query("select id from admin_account order by created_at limit 1");
    if (!owner.rowCount) throw new Error("browser_automation_test_owner_missing");
    ownerId = String(owner.rows[0].id);
  });

  afterAll(async () => {
    if (!db) return;
    if (definitionIds.length) {
      await db.query("delete from browser_automation_run where definition_id=any($1::uuid[])", [definitionIds]);
      await db.query("delete from browser_automation_definition where id=any($1::uuid[])", [definitionIds]);
    }
    await db.end();
  });

  it("keeps async runs idempotent and makes queued cancellation terminal", async () => {
    const definition = await db.query(
      `insert into browser_automation_definition(code,stable_key,display_name,status) values ($1,$1,'Queue contract fixture','ENABLED') returning id`,
      [`queue-${randomUUID().replaceAll("-", "").slice(0, 20)}`]
    );
    const definitionId = String(definition.rows[0].id); definitionIds.push(definitionId);
    const revision = await db.query(
      `insert into browser_automation_revision(definition_id,revision,manifest,canonical_json,digest,status,verification_status)
       values ($1,1,$2::jsonb,$3,$4,'ACTIVE','PASS') returning id`,
      [definitionId, JSON.stringify({ schemaVersion: "kcml.browser-automation.v1", steps: [{ action: "WAIT", text: "fixture" }] }), "fixture", `sha256:${"a".repeat(64)}`]
    );
    await db.query("update browser_automation_definition set active_revision_id=$2 where id=$1", [definitionId, revision.rows[0].id]);
    const key = `idempotent-${randomUUID()}`;
    const first = await createBrowserAutomationRun(db, definitionId, { safe: true }, key, null, ownerId, randomUUID());
    const replay = await createBrowserAutomationRun(db, definitionId, { safe: true }, key, null, ownerId, randomUUID());
    expect(replay.id).toBe(first.id);
    await requestBrowserAutomationCancel(db, first.id, ownerId, randomUUID());
    const stored = await db.query("select status,completed_at from browser_automation_run where id=$1", [first.id]);
    expect(stored.rows[0]).toMatchObject({ status: "CANCELLED" });
    expect(stored.rows[0].completed_at).not.toBeNull();
  });

  it("preserves immutable active revision runtime verification during static preflight", async () => {
    const manifest = {
      schemaVersion: "kcml.browser-automation.v1",
      steps: [{ action: "NAVIGATE", url: "https://example.com", sideEffectClass: "READ_ONLY" }]
    };
    const definition = await db.query(
      `insert into browser_automation_definition(code,stable_key,display_name,status) values ($1,$1,'Preflight contract fixture','DISABLED') returning id`,
      [`preflight-${randomUUID().replaceAll("-", "").slice(0, 20)}`]
    );
    const definitionId = String(definition.rows[0].id); definitionIds.push(definitionId);
    const revision = await db.query(
      `insert into browser_automation_revision(definition_id,revision,manifest,canonical_json,digest,status,verification_status,activated_at)
       values ($1,1,$2::jsonb,$3,$4,'ACTIVE','PASS',now()) returning id`,
      [definitionId, JSON.stringify(manifest), browserAutomationCanonicalJson(manifest), browserAutomationDigest(manifest)]
    );
    await db.query("update browser_automation_definition set active_revision_id=$2 where id=$1", [definitionId, revision.rows[0].id]);

    const result = await preflightBrowserAutomation(db, definitionId, ownerId, randomUUID());
    expect(result).toMatchObject({ valid: true, verificationStatus: "STATIC_VALIDATED", runtimeExecutionRequired: true });
    const stored = await db.query("select status,verification_status from browser_automation_revision where id=$1", [revision.rows[0].id]);
    expect(stored.rows[0]).toMatchObject({ status: "ACTIVE", verification_status: "PASS" });
    await expect(setBrowserAutomationEnabled(db, definitionId, true, ownerId, randomUUID())).resolves.toBeUndefined();
  });
});
