import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit } from "./audit.js";

/**
 * Historical maintenance only. The external onboarding creation product is retired;
 * this function exists solely so OWNER can retire/delete servers registered before the breaking transition.
 */
export async function deleteRegisteredServer(db: Db, serverId: string, actorId: string, correlationId: string, reason: string): Promise<void> {
  await tx(db, async (client) => {
    const server = await client.query(
      `select id, code, hostname, tool_name, display_name, registration_state, operational_state, active_revision_id
         from mcp_server
        where id=$1
        for update`,
      [serverId]
    );
    if (!server.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    const serverRow = server.rows[0];
    const jobs = await client.query(
      `select id, token_id, state
         from onboarding_job
        where server_id=$1 or code=$2
        for update`,
      [serverId, serverRow.code]
    );
    const jobIds = jobs.rows.map((row) => String(row.id));
    const tokenIds = [...new Set(jobs.rows.map((row) => String(row.token_id)))];
    const tokenFingerprints = tokenIds.length
      ? await client.query(
        `select id, fingerprint
           from integration_token
          where id = any($1::uuid[])
          for update`,
        [tokenIds]
      )
      : { rows: [] as Array<{ id: string; fingerprint: string }> };
    const managed = await client.query(
      `select id, code
         from managed_service
        where legacy_mcp_server_id=$1
        for update`,
      [serverId]
    );
    const managedIds = managed.rows.map((row) => String(row.id));

    await client.query("update access_token set revoked_at=coalesce(revoked_at,now()) where server_id=$1", [serverId]);
    await client.query("update egress_capability set revoked_at=coalesce(revoked_at,now()) where server_id=$1", [serverId]);

    if (tokenIds.length) {
      await client.query(
        `update integration_token
            set revoked_at=coalesce(revoked_at,now()),
                deleted_at=coalesce(deleted_at,now()),
                lock_version=lock_version+1
          where id = any($1::uuid[])`,
        [tokenIds]
      );
    }

    if (jobIds.length) {
      await client.query(
        `update onboarding_job
            set archived_at=coalesce(archived_at,now()),
                archive_reason=$2,
                runtime_stopped_at=coalesce(runtime_stopped_at,now()),
                lease_owner=null,
                lease_expires_at=null,
                state=case when state in ('ACTIVE','REGISTERED_DISABLED','TRIAL_TESTING') then 'CANCELLED'::onboarding_job_state else state end,
                lock_version=lock_version+1
          where id = any($1::uuid[])`,
        [jobIds, reason]
      );
    }

    if (managedIds.length) {
      await client.query(
        `update managed_service
            set enabled=false,
                lifecycle_state='RETIRED',
                api_state='DISABLED',
                retired_at=coalesce(retired_at,now()),
                lock_version=lock_version+1
          where id = any($1::uuid[])`,
        [managedIds]
      );
    }

    await client.query(
      `update mcp_server
          set enabled=false,
              registration_state='RETIRED'::registration_state,
              operational_state='RETIRED'::operational_state,
              retired_at=coalesce(retired_at,now()),
              archived_at=coalesce(archived_at,now()),
              archive_reason=$2,
              lock_version=lock_version+1
        where id=$1`,
      [serverId, reason]
    );
    await client.query(
      `update component c
          set enabled=false,
              ingress_enabled=false,
              pulse_enabled=false,
              egress_enabled=false,
              lifecycle_state='RETIRED',
              activation_state='INACTIVE',
              operational_state='RETIRED',
              retired_at=coalesce(c.retired_at,now()),
              lock_version=c.lock_version+1
         from mcp_server server
        where server.id=$1
          and c.id=server.component_id`,
      [serverId]
    );

    await appendAudit(client, {
      eventType: "mcp_server.archived",
      actorType: "admin",
      actorId,
      objectType: "mcp_server",
      objectId: serverId,
      before: {
        code: serverRow.code,
        hostname: serverRow.hostname,
        toolName: serverRow.tool_name,
        displayName: serverRow.display_name,
        registrationState: serverRow.registration_state,
        operationalState: serverRow.operational_state,
        onboardingJobIds: jobIds,
        integrationTokenFingerprints: tokenFingerprints.rows.map((row) => String(row.fingerprint)),
        managedServiceIds: managedIds
      },
      after: { archived: true, runtimeAccessRevoked: true, code: serverRow.code, reason },
      correlationId
    });
  });
}
