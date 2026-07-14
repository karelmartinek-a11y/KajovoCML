import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit } from "./audit.js";

export type InvocationOutcome = {
  success: boolean;
  latencyMs: number;
  errorClass: string | null;
  eventType: string;
  response: unknown;
  idempotency?: {
    key: string;
    credentialId: string;
  } | null;
};

export async function beginInvocation(db: Db, input: {
  serverId: string;
  credentialId: string;
  correlationId: string;
  requestDigest: string;
  idempotencyKey: string | null;
}): Promise<string> {
  return tx(db, async (client) => {
    const result = await client.query(
      `insert into mcp_invocation(server_id,credential_id,correlation_id,request_digest,idempotency_key,status)
       values ($1,$2,$3,$4,$5,'ACCEPTED') returning id`,
      [input.serverId, input.credentialId, input.correlationId, input.requestDigest, input.idempotencyKey]
    );
    const id = String(result.rows[0].id);
    await appendAudit(client, {
      eventType: "mcp.invocation.accepted",
      actorType: "kaja",
      actorId: input.credentialId,
      objectType: "mcp_server",
      objectId: input.serverId,
      after: { invocationId: id, requestDigest: input.requestDigest, idempotencyKeyPresent: Boolean(input.idempotencyKey) },
      correlationId: input.correlationId
    });
    return id;
  });
}

export async function finalizeInvocation(db: Db, input: {
  invocationId: string;
  serverId: string;
  credentialId: string;
  correlationId: string;
  outcome: InvocationOutcome;
}): Promise<void> {
  await tx(db, async (client) => {
    const responseDigest = `sha256:${createHash("sha256").update(JSON.stringify(input.outcome.response)).digest("hex")}`;
    const updated = await client.query(
      `update mcp_invocation
          set status=$2,latency_ms=$3,error_class=$4,response_digest=$5,finalized_at=now()
        where id=$1 and status='ACCEPTED'
        returning id`,
      [input.invocationId, input.outcome.success ? "SUCCEEDED" : "FAILED", input.outcome.latencyMs, input.outcome.errorClass, responseDigest]
    );
    if (!updated.rowCount) throw new Error("invocation_not_finalizable");
    await client.query(
      input.outcome.success
        ? `insert into function_statistics(server_id,success_count,last_success_at)
           values ($1,1,now())
           on conflict (server_id) do update set success_count=function_statistics.success_count+1,last_success_at=now()`
        : `insert into function_statistics(server_id,failure_count,last_failure_at)
           values ($1,1,now())
           on conflict (server_id) do update set failure_count=function_statistics.failure_count+1,last_failure_at=now()`,
      [input.serverId]
    );
    await client.query(
      "insert into mcp_invocation_metric(server_id,success,latency_ms,classification,correlation_id) values ($1,$2,$3,$4,$5)",
      [input.serverId, input.outcome.success, input.outcome.latencyMs, input.outcome.errorClass, input.correlationId]
    );
    if (input.outcome.idempotency) {
      await client.query(
        `update mcp_invocation_idempotency
            set status='COMPLETED',response_json=$4,completed_at=now()
          where server_id=$1 and credential_id=$2 and idempotency_key=$3`,
        [input.serverId, input.outcome.idempotency.credentialId, input.outcome.idempotency.key, JSON.stringify(input.outcome.response)]
      );
    }
    await appendAudit(client, {
      eventType: input.outcome.eventType,
      actorType: "kaja",
      actorId: input.credentialId,
      objectType: "mcp_server",
      objectId: input.serverId,
      after: {
        invocationId: input.invocationId,
        latencyMs: input.outcome.latencyMs,
        errorClass: input.outcome.errorClass,
        responseDigest
      },
      correlationId: input.correlationId
    });
  });
}

export async function recordFinalizationFailure(db: Db, input: {
  invocationId: string;
  serverId: string;
  correlationId: string;
  error: string;
}): Promise<void> {
  await tx(db, async (client) => {
    await client.query(
      `update mcp_invocation
          set status='FINALIZATION_FAILED',error_class='finalization',finalized_at=now()
        where id=$1 and status='ACCEPTED'`,
      [input.invocationId]
    );
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${input.serverId}:invocation.finalization_failed`]);
    const existing = await client.query(
      `select id from operational_alert
        where server_id=$1 and alert_type='invocation.finalization_failed'
          and status in ('OPEN','ACKNOWLEDGED','SUPPRESSED')
        for update`,
      [input.serverId]
    );
    let alertId: string;
    if (existing.rowCount) {
      alertId = String(existing.rows[0].id);
      await client.query(
        `update operational_alert set severity='CRITICAL',last_seen_at=now(),correlation_id=$2,
                detail=jsonb_build_object('invocationId',$3,'error',$4)
          where id=$1`,
        [alertId, input.correlationId, input.invocationId, input.error.slice(0, 500)]
      );
    } else {
      const alert = await client.query(
        `insert into operational_alert(server_id,severity,alert_type,title,detail,correlation_id)
         values ($1,'CRITICAL','invocation.finalization_failed','MCP invocation finalization failed',
                 jsonb_build_object('invocationId',$2,'error',$3),$4)
         returning id`,
        [input.serverId, input.invocationId, input.error.slice(0, 500), input.correlationId]
      );
      alertId = String(alert.rows[0].id);
      for (const channel of ["PRIMARY", "BACKUP"]) {
        await client.query(
          "insert into alert_webhook_delivery(alert_id,channel,idempotency_key) values ($1,$2,$3)",
          [alertId, channel, randomUUID()]
        );
      }
    }
  });
}
