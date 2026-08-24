import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { cancelGenerationJob, createGenerationJob } from "./generation.js";
import { approveSpec, canonicalJson, createLeasedAssistantMessage, createSpecRevision, digest, generationSpecificationSchema, queueDiscussionTurn, recoverExpiredDiscussionTurns, type GenerationSpec } from "./generation-discussion.js";

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
    openQuestions: [], browserAutomations: [], capabilityDecisions: []
  };
}

describe("GenerationSpecification compatibility", () => {
  it("keeps historical canonical payloads and digests unchanged when capability decisions are absent", () => {
    const historical = {
      objective: "Historical specification", resultSummary: "No capability field", behavioralRequirements: ["read"],
      inputsAndOutputs: ["typed"], externalSystems: [], businessRules: [], explicitOwnerDecisions: [], constraints: [],
      acceptanceCriteria: [], verifiedFacts: [], openQuestions: [], browserAutomations: []
    };
    const parsed = generationSpecificationSchema.parse(historical);
    expect(parsed).not.toHaveProperty("capabilityDecisions");
    expect(canonicalJson(parsed)).toBe(canonicalJson(historical));
    expect(digest(parsed)).toBe(digest(historical));
  });
});

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

  it("creates the leased assistant exactly once through a Pool without recursively reconnecting a PoolClient", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion assistant lease ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const turn = await db.query("select id from generation_discussion_turn where job_id=$1 and status='QUEUED'", [created.job.id]);
    const turnId = String(turn.rows[0].id);
    const lease = { owner: `worker-${randomUUID()}`, token: randomUUID() };
    await db.query("update generation_discussion_turn set status='RUNNING',lease_owner=$2,lease_token=$3,lease_until=now()+interval '1 minute' where id=$1", [turnId, lease.owner, lease.token]);
    const first = await createLeasedAssistantMessage(db, created.job.id, turnId, lease);
    const replay = await createLeasedAssistantMessage(db, created.job.id, turnId, lease);
    expect(replay.id).toBe(first.id);
    const messages = await db.query("select count(*)::int count from generation_job_message where job_id=$1 and role='ASSISTANT' and turn_id=$2", [created.job.id, turnId]);
    expect(Number(messages.rows[0].count)).toBe(1);
  });

  it("reuses an immutable historical digest while approval freezes the exact current revision", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion revision ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const turn = await db.query("select id from generation_discussion_turn where job_id=$1 order by created_at limit 1", [created.job.id]);
    const turnId = String(turn.rows[0].id);
    await db.query("update generation_discussion_turn set status='INTERRUPTED',interrupted_at=now(),completed_at=now() where id=$1", [turnId]);
    const first = await createSpecRevision(db, created.job.id, specification("A"), turnId);
    const second = await createSpecRevision(db, created.job.id, specification("B"), turnId);
    const third = await createSpecRevision(db, created.job.id, specification("A"), turnId);
    expect([first.revision, second.revision, third.revision]).toEqual([1, 2, 1]);
    expect(third.digest).toBe(first.digest);
    const stale = await db.query("select id from generation_spec_revision where job_id=$1 and revision=2", [created.job.id]);
    await expect(approveSpec(db, created.job.id, ownerId, String(stale.rows[0].id), second.digest)).rejects.toMatchObject({ message: "GENERATION_SPEC_STALE" });
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

  it("terminalizes an expired worker turn after its generation job was cancelled", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion cancelled crash ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const turn = await db.query("select id from generation_discussion_turn where job_id=$1 and status='QUEUED'", [created.job.id]);
    const turnId = String(turn.rows[0].id);
    await db.query("update generation_discussion_turn set status='RUNNING',lease_owner='dead-worker',lease_token=$2,lease_until=now()+interval '1 minute' where id=$1", [turnId, randomUUID()]);
    await db.query("insert into generation_job_message(job_id,role,content,turn_id,idempotency_key,status) values ($1,'ASSISTANT','partial',$2,$3,'STREAMING')", [created.job.id, turnId, `assistant:${turnId}`]);
    await cancelGenerationJob(db, created.job.id, ownerId, randomUUID());
    await db.query("update generation_discussion_turn set lease_until=now()-interval '1 second' where id=$1", [turnId]);
    expect(await recoverExpiredDiscussionTurns(db)).toBe(1);
    const recovered = await db.query("select status,error_code,lease_owner,lease_token,lease_until,completed_at from generation_discussion_turn where id=$1", [turnId]);
    expect(recovered.rows[0]).toMatchObject({ status: "INTERRUPTED", error_code: "discussion_lease_expired_job_terminal", lease_owner: null, lease_token: null, lease_until: null });
    expect(recovered.rows[0].completed_at).toBeTruthy();
  });

  it("rejects approval while a newer OWNER turn is queued", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion queued approval ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const firstTurn = await db.query("select id from generation_discussion_turn where job_id=$1 order by created_at limit 1", [created.job.id]);
    const turnId = String(firstTurn.rows[0].id);
    await db.query("update generation_discussion_turn set status='COMPLETED',completed_at=now() where id=$1", [turnId]);
    const revision = await createSpecRevision(db, created.job.id, specification("approval exact current"), turnId);
    await queueDiscussionTurn(db, created.job.id, ownerId, "Novější vstup musí projít turnem.", `queued-approval-${randomUUID()}`);
    await expect(approveSpec(db, created.job.id, ownerId, revision.id, revision.digest)).rejects.toMatchObject({ message: "GENERATION_TURN_ACTIVE" });
  });

  it("allocates concurrent immutable revisions without duplicate or lost sequence", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion revision concurrency ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const firstTurn = await db.query("select id from generation_discussion_turn where job_id=$1 order by created_at limit 1", [created.job.id]);
    const turnId = String(firstTurn.rows[0].id);
    await db.query("update generation_discussion_turn set status='COMPLETED',completed_at=now() where id=$1", [turnId]);
    const [one, two] = await Promise.all([
      createSpecRevision(db, created.job.id, specification("concurrent-one"), turnId),
      createSpecRevision(db, created.job.id, specification("concurrent-two"), turnId)
    ]);
    expect([one.revision, two.revision].sort((a, b) => a - b)).toEqual([1, 2]);
    const current = await db.query("select revision from generation_spec_revision where job_id=$1 order by revision", [created.job.id]);
    expect(current.rows.map((row) => Number(row.revision))).toEqual([1, 2]);
  });

  it("reclaims an expired discussion lease and rejects the old worker's specification write", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion lease recovery ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const turn = await db.query("select id from generation_discussion_turn where job_id=$1 and status='QUEUED'", [created.job.id]);
    const turnId = String(turn.rows[0].id);
    const oldToken = randomUUID();
    await db.query(
      "update generation_discussion_turn set status='RUNNING',lease_owner='worker-a',lease_token=$2,lease_until=now()-interval '1 second' where id=$1",
      [turnId, oldToken]
    );
    expect(await recoverExpiredDiscussionTurns(db)).toBe(1);
    const recovered = await db.query("select status,lease_owner,lease_token,error_code from generation_discussion_turn where id=$1", [turnId]);
    expect(recovered.rows[0]).toMatchObject({ status: "QUEUED", lease_owner: null, lease_token: null, error_code: "discussion_lease_expired" });
    await expect(createSpecRevision(db, created.job.id, specification("late old worker"), turnId, { owner: "worker-a", token: oldToken })).rejects.toMatchObject({ message: "discussion_lease_lost" });
  });

  it("terminalizes an expired superseded turn while preserving the queued OWNER successor", async () => {
    const created = await createGenerationJob(db, ownerId, `discussion lease successor ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const initial = await db.query("select id from generation_discussion_turn where job_id=$1 and status='QUEUED'", [created.job.id]);
    const oldTurnId = String(initial.rows[0].id);
    const oldToken = randomUUID();
    await db.query(
      "update generation_discussion_turn set status='RUNNING',lease_owner='worker-a',lease_token=$2,lease_until=now()-interval '1 second' where id=$1",
      [oldTurnId, oldToken]
    );
    await queueDiscussionTurn(db, created.job.id, ownerId, "Nový požadavek po pádu workeru", `lease-successor-${randomUUID()}`);
    expect(await recoverExpiredDiscussionTurns(db)).toBe(1);
    const turns = await db.query("select status,count(*)::int count from generation_discussion_turn where job_id=$1 group by status", [created.job.id]);
    expect(Object.fromEntries(turns.rows.map((row) => [String(row.status), Number(row.count)]))).toMatchObject({ INTERRUPTED: 1, QUEUED: 1 });
  });
});
