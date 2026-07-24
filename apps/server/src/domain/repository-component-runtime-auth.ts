import { randomUUID } from "node:crypto";
import type { EgressClientConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { createEphemeralEgressCapability } from "./egress.js";
import { hmacToken, issueOpaqueSecret } from "../security/secrets.js";
import { appendAudit } from "./audit.js";
import { validateComponentManifest } from "./component.js";
import type { ComponentManifest } from "./component.js";

type Queryable = Pick<Db, "query">;

async function repositoryComponentTarget(client: Queryable, repositoryKey: string): Promise<{
  componentId: string;
  principalId: string;
  principalPublicId: string;
  policyEpoch: number;
  revocationEpoch: number;
}> {
  const component = await client.query(
    `select c.id,p.id as principal_id,p.public_id,p.policy_epoch,p.revocation_epoch
       from component c
       join principal p on p.id=c.principal_id
      where c.deregistered_at is null
        and (
          lower(c.code::text)=lower($1)
          or lower(coalesce(p.metadata->>'repositoryKey',''))=lower($1)
        )
      order by
        case when lower(coalesce(p.metadata->>'repositoryKey',''))=lower($1) then 0 else 1 end,
        c.created_at desc
      limit 1
      for update of c,p`,
    [repositoryKey]
  );
  if (!component.rowCount) throw new Error("repository_component_not_registered");
  const row = component.rows[0];
  return {
    componentId: String(row.id),
    principalId: String(row.principal_id),
    principalPublicId: String(row.public_id),
    policyEpoch: Number(row.policy_epoch),
    revocationEpoch: Number(row.revocation_epoch)
  };
}

async function activeRepositoryComponentTarget(client: Queryable, repositoryKey: string): Promise<{
  componentId: string;
  principalId: string;
  principalPublicId: string;
  policyEpoch: number;
  revocationEpoch: number;
  manifest: ComponentManifest;
}> {
  const component = await client.query(
    `select c.id,p.id as principal_id,p.public_id,p.policy_epoch,p.revocation_epoch,revision.manifest
       from component c
       join principal p on p.id=c.principal_id
       join component_revision revision on revision.id=c.active_revision_id and revision.component_id=c.id
      where c.deregistered_at is null
        and (
          lower(c.code::text)=lower($1)
          or lower(coalesce(p.metadata->>'repositoryKey',''))=lower($1)
        )
      order by
        case when lower(coalesce(p.metadata->>'repositoryKey',''))=lower($1) then 0 else 1 end,
        c.created_at desc
      limit 1
      for update of c,p,revision`,
    [repositoryKey]
  );
  if (!component.rowCount) throw new Error("repository_component_not_registered");
  const row = component.rows[0];
  return {
    componentId: String(row.id),
    principalId: String(row.principal_id),
    principalPublicId: String(row.public_id),
    policyEpoch: Number(row.policy_epoch),
    revocationEpoch: Number(row.revocation_epoch),
    manifest: validateComponentManifest(row.manifest)
  };
}

export async function issueRepositoryComponentRuntimeSecretToken(db: Db, params: {
  repositoryKey: string;
  accessTokenHmacKey: Buffer;
  accessTokenHmacKeyId: string;
}): Promise<{ token: string; fingerprint: string; componentId: string; principalId: string }> {
  return tx(db, async (client) => {
    const component = await repositoryComponentTarget(client, params.repositoryKey);
    await client.query(
      `update principal_access_token
          set revoked_at=coalesce(revoked_at,now()),
              rotated_at=now(),
              rotation_reason='RUNTIME_DEPLOY_SUPERSEDED'
        where source_principal_id=$1
          and target_component_id=$2
          and audience='kcml-runtime-secret-broker'
          and revoked_at is null`,
      [component.principalId, component.componentId]
    );
    const issued = issueOpaqueSecret();
    await client.query(
      `insert into principal_access_token(
         lookup_digest,key_id,fingerprint,source_principal_id,target_component_id,audience,scope_names,
         issued_policy_epoch,issued_revocation_epoch,expires_at,handed_off_at
       ) values ($1,$2,$3,$4,$5,'kcml-runtime-secret-broker',array['secret.resolve'],$6,$7,'infinity',now())`,
      [
        hmacToken(issued.value, params.accessTokenHmacKey),
        params.accessTokenHmacKeyId,
        issued.fingerprint,
        component.principalId,
        component.componentId,
        component.policyEpoch,
        component.revocationEpoch
      ]
    );
    await appendAudit(client, {
      eventType: "principal_access_token.rotated",
      actorType: "system",
      actorId: null,
      objectType: "component",
      objectId: component.componentId,
      after: {
        reason: "RUNTIME_DEPLOY_SECRET_BROKER",
        fingerprint: issued.fingerprint,
        principalPublicId: component.principalPublicId
      },
      correlationId: randomUUID()
    });
    return {
      token: issued.value,
      fingerprint: issued.fingerprint,
      componentId: component.componentId,
      principalId: component.principalId
    };
  });
}

export async function issueRepositoryComponentRuntimeEgressCapability(db: Db, config: EgressClientConfig, repositoryKey: string): Promise<string | null> {
  return tx(db, async (client) => {
    const component = await activeRepositoryComponentTarget(client, repositoryKey);
    const runtime = component.manifest.runtime as { egressGrants?: unknown };
    const egressGrants = Array.isArray(runtime.egressGrants)
      ? runtime.egressGrants as Array<
          | { type: "HTTPS_FETCH"; targetHost: string; port: number }
          | { type: "TCP_TLS"; targetHost: string; port: number; servername: string }
        >
      : [];
    const httpsAllowlist: string[] = [];
    const tcpTlsAllowlist: Array<{ targetHost: string; port: number; servername: string; protocol: "TCP_TLS" }> = [];
    for (const grant of egressGrants) {
      if (grant.type === "HTTPS_FETCH") {
        httpsAllowlist.push(grant.port === 443 ? grant.targetHost : `${grant.targetHost}:${grant.port}`);
        continue;
      }
      if (grant.type === "TCP_TLS") {
        tcpTlsAllowlist.push({
          targetHost: grant.targetHost,
          port: grant.port,
          servername: grant.servername,
          protocol: "TCP_TLS"
        });
      }
    }
    if (httpsAllowlist.length === 0 && tcpTlsAllowlist.length === 0) return null;
    return createEphemeralEgressCapability(config, {
      allowlist: httpsAllowlist,
      tcpTlsAllowlist,
      purpose: "repository-component.runtime",
      correlationId: randomUUID(),
      ttlSeconds: 60 * 60 * 24 * 30
    });
  });
}
