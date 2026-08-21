import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { cancelGenerationJob, createGenerationJob } from "./generation.js";
import { approveSpec, createSpecRevision, queueDiscussionTurn, type GenerationSpec } from "./generation-discussion.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";
let db: Db;
let config: AppConfig;
let ownerId = "";
const jobIds: string[] = [];

function specification(objective: string): GenerationSpec {
  return {
    objective, resultSummary: "Runtime-backed discussion contract test", behavioralRequirements: ["Persist immutable revisions"],
    inputsAndOutputs: ["Owner input to typed generation plan"], externalSystems: [], businessRules: ["No stale approval"],
    explicitOwnerDecisions: [], constraints: ["PostgreSQL transaction"], acceptanceCriteria: ["FK is valid"], verifiedFacts: [],
    openQuestions: [], browserAutomations: []
  };
}

describe.skipIf(!enabled)("generation discussion PostgreSQL contract", () => {
  beforeAll(async () => {
    config = loadConfig(process.env);
    db = createDb(config);
    const owner = await db.query("select id from admin_account order by created_at limit 1");
    if (!owner.rowCount) throw new Error("generation_discussion_test_owner_missing");
    ownerId = String(owner.rows[0].id);
  });

  afterAll(async () => {
    if (!db) return;
    if (jobIds.length) await db.query("delete from generation_job where id=any($1::uuid[])", [jobIds]);
    await db.end();
  });

  it("persists the OWNER message before its turn and rejects conflicting idempotency without content mutation", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion FK ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const initial = await db.query(
      `select message.id message_id,message.content,message.turn_id,turn.input_message_id
         from generation_job_message message join generation_discussion_turn turn on turn.id=message.turn_id
        where message.job_id=$1 order by message.sequence limit 1`, [created.job.id]
    );
    expect(initial.rows[0]).toMatchObject({ input_message_id: initial.rows[0].message_id });
    const key = `client-${randomUUID()}`;
    const first = await queueDiscussionTurn(db, created.job.id, ownerId, "Změň business pravidlo.", key);
    const replay = await queueDiscussionTurn(db, created.job.id, ownerId, "Změň business pravidlo.", key);
    expect(replay).toMatchObject({ idempotent: true, messageId: first.messageId });
    await expect(queueDiscussionTurn(db, created.job.id, ownerId, "Jiný obsah nesmí přepsat zprávu.", key)).rejects.toMatchObject({ message: "generation_message_idempotency_conflict" });
    const stored = await db.query("select content from generation_job_message where id=$1", [first.messageId]);
    expect(String(stored.rows[0].content)).toBe("Změň business pravidlo.");
  });

  it("allows a historical digest as a new revision while approval freezes only the current exact revision", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion revision ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const turn = await db.query("select id from generation_discussion_turn where job_id=$1 order by created_at limit 1", [created.job.id]);
    const turnId = String(turn.rows[0].id);
    await db.query("update generation_discussion_turn set status='INTERRUPTED',interrupted_at=now(),completed_at=now() where id=$1", [turnId]);
    const first = await createSpecRevision(db, created.job.id, specification("A"), turnId);
    const second = await createSpecRevision(db, created.job.id, specification("B"), turnId);
    const third = await createSpecRevision(db, created.job.id, specification("A"), turnId);
    expect([first.revision, second.revision, third.revision]).toEqual([1, 2, 3]);
    expect(third.digest).toBe(first.digest);
    await expect(approveSpec(db, created.job.id, ownerId, second.id, second.digest)).rejects.toMatchObject({ message: "GENERATION_SPEC_STALE" });
    await expect(approveSpec(db, created.job.id, ownerId, third.id, third.digest)).resolves.toMatchObject({ idempotent: false, revisionId: third.id });
    const frozen = await db.query("select approved_spec_revision_id,approved_spec_digest,state from generation_job where id=$1", [created.job.id]);
    expect(frozen.rows[0]).toMatchObject({ approved_spec_revision_id: third.id, approved_spec_digest: third.digest, state: "ANALYZING" });
  });

  it("keeps one queued successor while steering an upstream turn and supersedes older pending input", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion steer ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const initial = await db.query("select id from generation_discussion_turn where job_id=$1 and status='QUEUED'", [created.job.id]);
    await db.query("update generation_discussion_turn set status='RUNNING',lease_owner='worker-a',lease_until=now()+interval '1 minute' where id=$1", [initial.rows[0].id]);
    await queueDiscussionTurn(db, created.job.id, ownerId, "První steer", `steer-1-${randomUUID()}`);
    await queueDiscussionTurn(db, created.job.id, ownerId, "Nejnovější steer", `steer-2-${randomUUID()}`);
    const turns = await db.query("select status,count(*)::int count from generation_discussion_turn where job_id=$1 group by status", [created.job.id]);
    expect(Object.fromEntries(turns.rows.map((row) => [String(row.status), Number(row.count)]))).toMatchObject({ INTERRUPT_REQUESTED: 1, QUEUED: 1, INTERRUPTED: 1 });
  });

  it("cancels queued discussion work and interrupts an OWNER-visible streaming assistant", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion cancel ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const turn = await db.query("select id,input_message_id from generation_discussion_turn where job_id=$1 and status='QUEUED'", [created.job.id]);
    await db.query("update generation_discussion_turn set status='RUNNING',lease_owner='worker-a',lease_until=now()+interval '1 minute' where id=$1", [turn.rows[0].id]);
    await db.query("insert into generation_job_message(job_id,role,content,turn_id,status) values ($1,'ASSISTANT','partial output',$2,'STREAMING')", [created.job.id, turn.rows[0].id]);
    await cancelGenerationJob(db, created.job.id, ownerId, randomUUID());
    const state = await db.query("select state from generation_job where id=$1", [created.job.id]);
    const terminal = await db.query("select status from generation_discussion_turn where id=$1", [turn.rows[0].id]);
    const message = await db.query("select status from generation_job_message where job_id=$1 and role='ASSISTANT'", [created.job.id]);
    expect(state.rows[0].state).toBe("CANCELLED");
    expect(terminal.rows[0].status).toBe("INTERRUPT_REQUESTED");
    expect(message.rows[0].status).toBe("INTERRUPTED");
  });
});
