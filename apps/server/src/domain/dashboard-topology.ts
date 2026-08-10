import { createHash } from "node:crypto";
import argon2 from "argon2";
import { authenticator } from "otplib";
import type pg from "pg";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { decryptMfaSecret } from "../security/secrets.js";
import { appendAudit } from "./audit.js";
import { grantSecret } from "./secret-manager.js";

export const DASHBOARD_COMPATIBILITY_EVALUATOR_VERSION = "dashboard-compatibility/1";

type Queryable = Pick<Db, "query"> | pg.PoolClient;

export type DashboardPort = {
  key: string;
  componentId: string;
  revisionId: string;
  direction: "INCOMING" | "OUTGOING";
  kind: "PULSE";
  label: string;
  pulseType: string;
  routes: string[];
  scopes: string[];
  protocol: string;
  transport: string;
  authMode: string;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  contractDigest: string;
  source: Record<string, unknown> & { externalSources?: Array<{ publicId: string; routePattern: string; scopeName: string }> };
};

export type CompatibilityStatus = "EXACT_MATCH" | "COMPATIBLE_WITH_DIFFERENCES" | "INCOMPATIBLE" | "UNKNOWN";
export type CompatibilityResult = {
  status: CompatibilityStatus;
  evaluatorVersion: string;
  sourceDigest: string;
  targetDigest: string;
  evidenceDigest: string;
  checks: Array<{ field: string; result: "PASS" | "WARN" | "FAIL" | "UNKNOWN"; reason: string }>;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function schemaType(schema: Record<string, unknown>): string | null {
  return typeof schema.type === "string" ? schema.type : null;
}

function routeMatches(left: string, right: string): boolean {
  if (left === right || left === "*" || right === "*") return true;
  if (left.endsWith("/*")) return right.startsWith(left.slice(0, -1));
  if (right.endsWith("/*")) return left.startsWith(right.slice(0, -1));
  return false;
}

export function evaluateDashboardPortCompatibility(source: DashboardPort, target: DashboardPort): CompatibilityResult {
  const checks: CompatibilityResult["checks"] = [];
  if (source.direction !== "OUTGOING" || target.direction !== "INCOMING") {
    checks.push({ field: "direction", result: "FAIL", reason: "Spojení musí vést z odchozího do příchozího portu." });
  } else {
    checks.push({ field: "direction", result: "PASS", reason: "Směr portů je platný." });
  }
  checks.push(source.pulseType === target.pulseType
    ? { field: "pulseType", result: "PASS", reason: "Typ PULSE je shodný." }
    : { field: "pulseType", result: "FAIL", reason: `Typy PULSE se liší (${source.pulseType} / ${target.pulseType}).` });
  const routeCompatible = source.routes.length === 0 || target.routes.length === 0
    ? null
    : source.routes.some((left) => target.routes.some((right) => routeMatches(left, right)));
  checks.push(routeCompatible === null
    ? { field: "route", result: "UNKNOWN", reason: "Jeden z kontraktů neuvádí cestu volání." }
    : routeCompatible
      ? { field: "route", result: "PASS", reason: "Cesty volání se překrývají." }
      : { field: "route", result: "FAIL", reason: "Cesty volání se nepřekrývají." });
  const scopeCompatible = source.scopes.length === 0 || target.scopes.length === 0
    ? null
    : source.scopes.some((scope) => target.scopes.includes(scope) || scope === "*" || target.scopes.includes("*"));
  checks.push(scopeCompatible === null
    ? { field: "scope", result: "UNKNOWN", reason: "Jeden z kontraktů neuvádí rozsah oprávnění." }
    : scopeCompatible
      ? { field: "scope", result: "PASS", reason: "Rozsahy oprávnění mají společnou hodnotu." }
      : { field: "scope", result: "FAIL", reason: "Rozsahy oprávnění nemají společnou hodnotu." });
  const sourceSchemaType = schemaType(source.requestSchema);
  const targetSchemaType = schemaType(target.requestSchema);
  checks.push(!sourceSchemaType || !targetSchemaType
    ? { field: "requestSchema", result: "UNKNOWN", reason: "Schéma neobsahuje jednoznačný kořenový typ." }
    : sourceSchemaType === targetSchemaType
      ? { field: "requestSchema", result: "PASS", reason: `Kořenový typ požadavku je ${sourceSchemaType}.` }
      : { field: "requestSchema", result: "FAIL", reason: `Kořenové typy požadavku se liší (${sourceSchemaType} / ${targetSchemaType}).` });
  if (sourceSchemaType && targetSchemaType && sourceSchemaType === targetSchemaType) {
    checks.push(digest(source.requestSchema) === digest(target.requestSchema)
      ? { field: "requestSchemaShape", result: "PASS", reason: "Schémata požadavku jsou kanonicky shodná." }
      : { field: "requestSchemaShape", result: "WARN", reason: "Kořenový typ je shodný, ale položková struktura schématu se liší a musí ji potvrdit runtime validace." });
  }
  checks.push(source.protocol === target.protocol
    ? { field: "protocol", result: "PASS", reason: `Protokol ${source.protocol} je shodný.` }
    : { field: "protocol", result: "FAIL", reason: `Protokoly se liší (${source.protocol} / ${target.protocol}).` });
  checks.push(source.transport === target.transport
    ? { field: "transport", result: "PASS", reason: `Transport ${source.transport} je shodný.` }
    : { field: "transport", result: "FAIL", reason: `Transporty se liší (${source.transport} / ${target.transport}).` });

  const failed = checks.some((check) => check.result === "FAIL");
  const unknown = checks.some((check) => check.result === "UNKNOWN");
  const warned = checks.some((check) => check.result === "WARN");
  const status: CompatibilityStatus = failed ? "INCOMPATIBLE" : unknown ? "UNKNOWN" : warned ? "COMPATIBLE_WITH_DIFFERENCES" : "EXACT_MATCH";
  const evidence = {
    evaluatorVersion: DASHBOARD_COMPATIBILITY_EVALUATOR_VERSION,
    sourceDigest: source.contractDigest,
    targetDigest: target.contractDigest,
    checks
  };
  return { status, ...evidence, evidenceDigest: digest(evidence) };
}

function portFromRow(row: Record<string, unknown>): DashboardPort {
  const direction = String(row.direction) as DashboardPort["direction"];
  const source = {
    id: String(row.id),
    pulseType: String(row.pulse_type),
    executionMode: String(row.execution_mode),
    idempotency: String(row.idempotency),
    tokenRequired: Boolean(row.token_required),
    envelopeSchema: row.envelope_schema
  };
  const requestSchema = (row.envelope_schema && typeof row.envelope_schema === "object")
    ? row.envelope_schema as Record<string, unknown>
    : {};
  const key = `pulse:${String(row.id)}`;
  return {
    key,
    componentId: String(row.component_id),
    revisionId: String(row.revision_id),
    direction,
    kind: "PULSE",
    label: `${String(row.pulse_type)} · ${direction === "INCOMING" ? "Příchozí" : "Odchozí"}`,
    pulseType: String(row.pulse_type),
    routes: textArray(row.route_acl),
    scopes: textArray(row.scopes),
    protocol: "PULSE",
    transport: "HTTPS",
    authMode: row.token_required ? "BEARER" : "NONE",
    requestSchema,
    responseSchema: {},
    contractDigest: digest(source),
    source
  };
}

async function listPorts(client: Queryable, componentIds?: string[]): Promise<DashboardPort[]> {
  const values: unknown[] = [];
  const filter = componentIds?.length ? "and mask.component_id = any($1::uuid[])" : "";
  if (componentIds?.length) values.push(componentIds);
  const result = await client.query(
    `select mask.*
       from component_pulse_mask mask
       join component component on component.id=mask.component_id and component.active_revision_id=mask.revision_id
      where component.deregistered_at is null ${filter}
      order by component.code,mask.direction,mask.pulse_type,mask.id`,
    values
  );
  const ports = result.rows.map((row) => portFromRow(row as Record<string, unknown>));
  if (!ports.length) return ports;

  const componentIdsWithPorts = [...new Set(ports.map((port) => port.componentId))];
  const externalPermissions = await client.query(
    `select permission.target_component_id,permission.route_pattern,permission.scope_name,external.public_id
       from principal_component_permission permission
       join component_external_principal external on external.principal_id=permission.source_principal_id
      where permission.target_component_id = any($1::uuid[])
        and permission.revoked_at is null
        and external.status = 'ACTIVE'
      order by external.public_id,permission.route_pattern,permission.scope_name`,
    [componentIdsWithPorts]
  );
  for (const port of ports.filter((item) => item.direction === "INCOMING")) {
    const externalSources = externalPermissions.rows
      .filter((row) => String(row.target_component_id) === port.componentId
        && (port.routes.length === 0 || port.routes.some((route) => routeMatches(String(row.route_pattern), route)))
        && (port.scopes.length === 0 || port.scopes.includes(String(row.scope_name)) || port.scopes.includes("*") || String(row.scope_name) === "*"))
      .map((row) => ({ publicId: String(row.public_id), routePattern: String(row.route_pattern), scopeName: String(row.scope_name) }));
    if (externalSources.length) port.source.externalSources = externalSources;
  }
  return ports;
}

async function findPort(client: Queryable, componentId: string, key: string, expectedDirection: DashboardPort["direction"]): Promise<DashboardPort> {
  const ports = await listPorts(client, [componentId]);
  const port = ports.find((item) => item.key === key && item.direction === expectedDirection);
  if (!port) throw Object.assign(new Error("dashboard_port_not_found"), { statusCode: 404 });
  return port;
}

async function workspace(client: Queryable, adminId: string): Promise<Record<string, unknown>> {
  const result = await client.query(
    `insert into dashboard_workspace(owner_admin_id,workspace_key)
     values ($1,'DEFAULT')
     on conflict (owner_admin_id,workspace_key) do update set owner_admin_id=excluded.owner_admin_id
     returning *`,
    [adminId]
  );
  return result.rows[0] as Record<string, unknown>;
}

export async function saveDashboardLayout(db: Db, input: {
  actorId: string;
  expectedVersion?: number;
  viewport: { x: number; y: number; zoom: number };
  positions: Array<{ nodeId: string; x: number; y: number }>;
  correlationId: string;
}): Promise<Record<string, unknown>> {
  return tx<Record<string, unknown>>(db, async (client) => {
    const current = await workspace(client, input.actorId);
    if (input.expectedVersion !== undefined && Number(current.lock_version) !== input.expectedVersion) {
      throw Object.assign(new Error("dashboard_layout_version_conflict"), { statusCode: 409 });
    }
    for (const position of input.positions) {
      await client.query(
        `insert into dashboard_node_position(workspace_id,node_id,x,y)
         select $1,$2,$3,$4 where exists(select 1 from dashboard_visual_node where id=$2 and deleted_at is null)
         on conflict (workspace_id,node_id) do update set x=excluded.x,y=excluded.y,updated_at=now()`,
        [current.id, position.nodeId, position.x, position.y]
      );
    }
    const updated = await client.query<Record<string, unknown>>(
      `update dashboard_workspace set viewport=$2::jsonb,lock_version=lock_version+1,updated_at=now()
        where id=$1 returning id,viewport,lock_version,updated_at`,
      [current.id, JSON.stringify(input.viewport)]
    );
    const updatedWorkspace = updated.rows[0] ?? {};
    await appendAudit(client, {
      eventType: "dashboard.layout.updated", actorType: "admin", actorId: input.actorId,
      objectType: "dashboard_workspace", objectId: String(current.id),
      after: { nodeCount: input.positions.length, viewport: input.viewport, lockVersion: updatedWorkspace.lock_version },
      correlationId: input.correlationId
    });
    return updatedWorkspace;
  });
}

async function ensurePermission(client: pg.PoolClient, input: {
  sourceComponentId: string; targetComponentId: string; route: string; scope: string; actorId: string;
}): Promise<string> {
  const result = await client.query(
    `insert into component_permission(source_component_id,target_component_id,route_pattern,scope_name,access_level,granted_by_type,granted_by_id)
     values ($1,$2,$3,$4,'INVOKE','admin',$5)
     on conflict (source_component_id,target_component_id,route_pattern,scope_name)
     do update set revoked_at=null,granted_at=now(),granted_by_type='admin',granted_by_id=excluded.granted_by_id
     returning id`,
    [input.sourceComponentId, input.targetComponentId, input.route, input.scope, input.actorId]
  );
  const permissionId = String(result.rows[0].id);
  await client.query(
    `update pulse_topology_connection set permission_id=$5
      where source_component_id=$1 and target_component_id=$2 and target_route=$3 and target_scope=$4 and revoked_at is null and authorization_desired is true`,
    [input.sourceComponentId, input.targetComponentId, input.route, input.scope, permissionId]
  );
  await client.query("update component set policy_epoch=policy_epoch+1,updated_at=now() where id = any($1::uuid[])", [[input.sourceComponentId, input.targetComponentId]]);
  const principal = await client.query("select principal_id from component where id=$1", [input.sourceComponentId]);
  if (principal.rowCount) await client.query("update principal set policy_epoch=policy_epoch+1,updated_at=now() where id=$1", [principal.rows[0].principal_id]);
  return permissionId;
}

async function reconcilePermission(client: pg.PoolClient, edge: Record<string, unknown>, actorId: string): Promise<string | null> {
  const desired = await client.query(
    `select 1 from pulse_topology_connection
      where source_component_id=$1 and target_component_id=$2 and target_route=$3 and target_scope=$4
        and revoked_at is null and authorization_desired is true limit 1`,
    [edge.source_component_id, edge.target_component_id, edge.target_route, edge.target_scope]
  );
  if (desired.rowCount) {
    return ensurePermission(client, {
      sourceComponentId: String(edge.source_component_id), targetComponentId: String(edge.target_component_id),
      route: String(edge.target_route), scope: String(edge.target_scope), actorId
    });
  }
  const revoked = await client.query(
    `update component_permission set revoked_at=coalesce(revoked_at,now())
      where source_component_id=$1 and target_component_id=$2 and route_pattern=$3 and scope_name=$4
      returning id`,
    [edge.source_component_id, edge.target_component_id, edge.target_route, edge.target_scope]
  );
  await client.query("update component set policy_epoch=policy_epoch+1,updated_at=now() where id = any($1::uuid[])", [[edge.source_component_id, edge.target_component_id]]);
  return revoked.rowCount ? String(revoked.rows[0].id) : null;
}

function selectedValue(requested: string | undefined, sourceValues: string[], targetValues: string[], kind: string): string {
  if (requested) {
    const allowed = targetValues.some((value) => routeMatches(value, requested)) && (sourceValues.length === 0 || sourceValues.some((value) => routeMatches(value, requested)));
    if (!allowed) throw Object.assign(new Error(`dashboard_${kind}_not_in_contract`), { statusCode: 409 });
    return requested;
  }
  const candidate = targetValues.find((target) => sourceValues.length === 0 || sourceValues.some((source) => routeMatches(source, target)));
  if (!candidate) throw Object.assign(new Error(`dashboard_${kind}_required`), { statusCode: 409 });
  return candidate;
}

export async function previewDashboardConnection(db: Db, input: {
  sourceComponentId: string; sourcePortKey: string; targetComponentId: string; targetPortKey: string;
}) {
  const [source, target] = await Promise.all([
    findPort(db, input.sourceComponentId, input.sourcePortKey, "OUTGOING"),
    findPort(db, input.targetComponentId, input.targetPortKey, "INCOMING")
  ]);
  return { source, target, compatibility: evaluateDashboardPortCompatibility(source, target) };
}

export async function createDashboardConnection(db: Db, input: {
  sourceComponentId: string; sourcePortKey: string; targetComponentId: string; targetPortKey: string;
  targetRoute?: string; targetScope?: string; grantAuthorization?: boolean; actorId: string; correlationId: string;
}) {
  if (input.sourceComponentId === input.targetComponentId) throw Object.assign(new Error("dashboard_self_connection_forbidden"), { statusCode: 409 });
  return tx(db, async (client) => {
    const lockedComponents = await client.query(
      "select id from component where id = any($1::uuid[]) and deregistered_at is null for update",
      [[input.sourceComponentId, input.targetComponentId]]
    );
    if (lockedComponents.rowCount !== 2) throw Object.assign(new Error("component_not_found"), { statusCode: 404 });
    const source = await findPort(client, input.sourceComponentId, input.sourcePortKey, "OUTGOING");
    const target = await findPort(client, input.targetComponentId, input.targetPortKey, "INCOMING");
    const compatibility = evaluateDashboardPortCompatibility(source, target);
    const route = selectedValue(input.targetRoute, source.routes, target.routes, "route");
    const scope = selectedValue(input.targetScope, source.scopes, target.scopes, "scope");
    const targetComponent = await client.query("select hostname from component where id=$1", [input.targetComponentId]);
    if (!targetComponent.rowCount) throw Object.assign(new Error("component_not_found"), { statusCode: 404 });
    const audience = `https://${String(targetComponent.rows[0].hostname).toLowerCase()}`;
    const authorizationDesired = input.grantAuthorization !== false;
    const inserted = await client.query(
      `insert into pulse_topology_connection(
        source_component_id,source_port_key,source_revision_id,source_contract_digest,
        target_component_id,target_port_key,target_revision_id,target_contract_digest,target_route,target_scope,audience,
        compatibility_status,compatibility_evaluator_version,compatibility_evidence,authorization_desired,created_by,correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)
       on conflict (source_component_id,source_port_key,target_component_id,target_port_key,target_route,target_scope,audience)
         where revoked_at is null
       do update set compatibility_status=excluded.compatibility_status,
         compatibility_evaluator_version=excluded.compatibility_evaluator_version,
         compatibility_evidence=excluded.compatibility_evidence,
         authorization_desired=excluded.authorization_desired,
         lock_version=pulse_topology_connection.lock_version+1
       returning *`,
      [input.sourceComponentId, source.key, source.revisionId, source.contractDigest,
        input.targetComponentId, target.key, target.revisionId, target.contractDigest, route, scope, audience,
        compatibility.status, compatibility.evaluatorVersion, JSON.stringify(compatibility), authorizationDesired, input.actorId, input.correlationId]
    );
    const edge = inserted.rows[0] as Record<string, unknown>;
    const permissionId = await reconcilePermission(client, edge, input.actorId);
    if (permissionId) await client.query("update pulse_topology_connection set permission_id=$2 where id=$1", [edge.id, permissionId]);
    await appendAudit(client, {
      eventType: "dashboard.connection.created", actorType: "admin", actorId: input.actorId,
      objectType: "pulse_topology_connection", objectId: String(edge.id),
      after: { sourceComponentId: input.sourceComponentId, targetComponentId: input.targetComponentId, route, scope, audience, compatibility, authorizationDesired, permissionId },
      correlationId: input.correlationId
    });
    return connectionSnapshot(client, String(edge.id));
  });
}

async function connectionSnapshot(client: Queryable, connectionId: string) {
  const result = await client.query(
    `select edge.*,permission.revoked_at permission_revoked_at,
            suspension.id suspension_id,token_envelope.id token_envelope_id,
            source.code source_code,target.code target_code
       from pulse_topology_connection edge
       join component source on source.id=edge.source_component_id
       join component target on target.id=edge.target_component_id
       left join component_permission permission on permission.id=edge.permission_id
       left join principal_permission_suspension suspension on suspension.principal_id=source.principal_id and suspension.resumed_at is null
       left join lateral (
         select token.id from principal_access_token token
          where token.source_principal_id=source.principal_id and token.revoked_at is null and token.expires_at>now()
            and (token.target_component_id is null or token.target_component_id=edge.target_component_id)
            and (token.audience='*' or lower(token.audience)=lower(edge.audience))
            and ('*'=any(token.scope_names) or edge.target_scope=any(token.scope_names))
          order by token.created_at desc limit 1
       ) token_envelope on true
      where edge.id=$1`,
    [connectionId]
  );
  if (!result.rowCount) throw Object.assign(new Error("dashboard_connection_not_found"), { statusCode: 404 });
  const row = result.rows[0] as Record<string, unknown>;
  return {
    ...row,
    effectiveAuthorization: row.revoked_at || !row.authorization_desired || row.permission_revoked_at || row.suspension_id || !row.token_envelope_id ? "DENIED" : "GRANTED",
    authorizationReason: row.revoked_at ? "DISCONNECTED" : row.suspension_id ? "IDENTITY_SUSPENDED" : !row.authorization_desired ? "EDGE_PERMISSION_REVOKED" : row.permission_revoked_at ? "PERMISSION_REVOKED" : !row.token_envelope_id ? "TOKEN_SCOPE_OR_AUDIENCE_MISSING" : "PERMISSION_ACTIVE"
  };
}

export async function setDashboardConnectionAuthorization(db: Db, input: {
  connectionId: string; enabled: boolean; actorId: string; correlationId: string;
}) {
  return tx(db, async (client) => {
    const current = await client.query("select * from pulse_topology_connection where id=$1 and revoked_at is null for update", [input.connectionId]);
    if (!current.rowCount) throw Object.assign(new Error("dashboard_connection_not_found"), { statusCode: 404 });
    const edge = current.rows[0] as Record<string, unknown>;
    await client.query("update pulse_topology_connection set authorization_desired=$2,lock_version=lock_version+1 where id=$1", [input.connectionId, input.enabled]);
    const permissionId = await reconcilePermission(client, { ...edge, authorization_desired: input.enabled }, input.actorId);
    if (permissionId) await client.query("update pulse_topology_connection set permission_id=$2 where id=$1", [input.connectionId, permissionId]);
    await appendAudit(client, {
      eventType: input.enabled ? "dashboard.connection.authorization_granted" : "dashboard.connection.authorization_revoked",
      actorType: "admin", actorId: input.actorId, objectType: "pulse_topology_connection", objectId: input.connectionId,
      before: { authorizationDesired: Boolean(edge.authorization_desired) }, after: { authorizationDesired: input.enabled, permissionId }, correlationId: input.correlationId
    });
    return connectionSnapshot(client, input.connectionId);
  });
}

export async function disconnectDashboardConnection(db: Db, input: { connectionId: string; actorId: string; correlationId: string }) {
  return tx(db, async (client) => {
    const current = await client.query("select * from pulse_topology_connection where id=$1 and revoked_at is null for update", [input.connectionId]);
    if (!current.rowCount) throw Object.assign(new Error("dashboard_connection_not_found"), { statusCode: 404 });
    const edge = current.rows[0] as Record<string, unknown>;
    await client.query(
      "update pulse_topology_connection set state='DISCONNECTED',authorization_desired=false,revoked_at=now(),revoked_by=$2,lock_version=lock_version+1 where id=$1",
      [input.connectionId, input.actorId]
    );
    await reconcilePermission(client, edge, input.actorId);
    await appendAudit(client, {
      eventType: "dashboard.connection.disconnected", actorType: "admin", actorId: input.actorId,
      objectType: "pulse_topology_connection", objectId: input.connectionId,
      before: { state: edge.state, authorizationDesired: edge.authorization_desired }, after: { state: "DISCONNECTED" }, correlationId: input.correlationId
    });
    return { id: input.connectionId, disconnected: true };
  });
}

export async function setDashboardNodeSuspension(db: Db, input: {
  nodeId: string; suspended: boolean; reason: string; actorId: string; correlationId: string;
}) {
  return tx(db, async (client) => {
    const node = await client.query(
      `select node.*,component.code from dashboard_visual_node node
       join component component on component.id=node.component_id
       where node.id=$1 and node.lifecycle_phase='REGISTERED' and node.deleted_at is null for update of node`,
      [input.nodeId]
    );
    if (!node.rowCount || !node.rows[0].principal_id) throw Object.assign(new Error("dashboard_registered_node_not_found"), { statusCode: 404 });
    const principalId = String(node.rows[0].principal_id);
    if (input.suspended) {
      await client.query(
        `insert into principal_permission_suspension(principal_id,reason,suspended_by,correlation_id)
         values ($1,$2,$3,$4)
         on conflict (principal_id) where resumed_at is null do update set reason=excluded.reason,correlation_id=excluded.correlation_id`,
        [principalId, input.reason, input.actorId, input.correlationId]
      );
    } else {
      await client.query(
        `update principal_permission_suspension set resumed_at=now(),resumed_by=$2
          where principal_id=$1 and resumed_at is null`,
        [principalId, input.actorId]
      );
    }
    await client.query("update principal set policy_epoch=policy_epoch+1,updated_at=now() where id=$1", [principalId]);
    await client.query("update component set policy_epoch=policy_epoch+1,updated_at=now() where id=$1", [node.rows[0].component_id]);
    await appendAudit(client, {
      eventType: input.suspended ? "dashboard.identity.suspended" : "dashboard.identity.resumed", actorType: "admin", actorId: input.actorId,
      objectType: "component", objectId: String(node.rows[0].component_id), after: { nodeId: input.nodeId, code: node.rows[0].code, reason: input.reason }, correlationId: input.correlationId
    });
    return { nodeId: input.nodeId, suspended: input.suspended, reason: input.reason };
  });
}

export async function listDashboardIdentityCards(db: Db) {
  const result = await db.query(
    `select node.id node_id,node.label,
            component.id component_id,component.code,component.display_name,
            principal.public_id,principal.status,
            access.fingerprint access_fingerprint,access.last_used_at,access.expires_at access_expires_at
       from dashboard_visual_node node
       join component component on component.id=node.component_id
       join principal principal on principal.id=node.principal_id
       left join lateral (
         select fingerprint,last_used_at,expires_at from principal_access_token
          where source_principal_id=node.principal_id and revoked_at is null order by created_at desc limit 1
       ) access on true
      where node.deleted_at is null and node.lifecycle_phase='REGISTERED'
      order by node.label`
  );
  return result.rows.map((row) => ({
    nodeId: String(row.node_id),
    identityType: "COMPONENT" as const,
    displayName: row.display_name ?? row.label,
    code: row.code ?? null,
    publicId: row.public_id ?? null,
    status: row.status === "ACTIVE" && row.access_expires_at && new Date(row.access_expires_at).getTime() <= Date.now() ? "EXPIRED" : row.status ?? "UNKNOWN",
    fingerprint: row.access_fingerprint ?? null,
    lastUsedAt: row.last_used_at ?? null,
    componentId: row.component_id ?? null
  }));
}

export async function grantDashboardSecretToNode(db: Db, input: {
  secretId: string; nodeId: string; actorId: string; correlationId: string;
}): Promise<{ status: "CREATED" | "ALREADY_GRANTED"; nodeId: string; secretId: string }> {
  const node = await db.query(
    `select node.component_id,node.principal_id,component.code,component.deregistered_at,principal.status principal_status
       from dashboard_visual_node node
       join component component on component.id=node.component_id
       join principal principal on principal.id=node.principal_id
      where node.id=$1 and node.deleted_at is null and node.lifecycle_phase='REGISTERED'`,
    [input.nodeId]
  );
  if (!node.rowCount) throw Object.assign(new Error("dashboard_registered_node_not_found"), { statusCode: 404 });
  const row = node.rows[0];
  if (!row.component_id || !row.principal_id || row.deregistered_at || String(row.principal_status) !== "ACTIVE") {
    throw Object.assign(new Error("dashboard_identity_unavailable"), { statusCode: 409 });
  }
  const existing = await db.query(
    `select 1 from secret_grant where secret_id=$1 and principal_kind='COMPONENT' and principal_id=$2 and revoked_at is null`,
    [input.secretId, row.component_id]
  );
  await grantSecret(db, input.actorId, input.correlationId, input.secretId, {
    principalKind: "COMPONENT", principalId: String(row.component_id), principalPublicId: String(row.code)
  });
  return { status: existing.rowCount ? "ALREADY_GRANTED" : "CREATED", nodeId: input.nodeId, secretId: input.secretId };
}

export async function previewBulkDashboardSecret(db: Db, secretId: string) {
  const secret = await db.query("select id,stable_name,status,deleted_at from secret_record where id=$1", [secretId]);
  if (!secret.rowCount || secret.rows[0].deleted_at) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  const nodes = await db.query(
    `select node.id,node.label,node.component_id,component.code,component.deregistered_at,principal.status principal_status,
            exists(select 1 from secret_grant grant_row
              where grant_row.secret_id=$1 and grant_row.principal_kind='COMPONENT'
                and grant_row.principal_id=node.component_id and grant_row.revoked_at is null) direct_granted
       from dashboard_visual_node node
       join component component on component.id=node.component_id
       join principal principal on principal.id=node.principal_id
      where node.deleted_at is null and node.lifecycle_phase='REGISTERED'
      order by node.created_at,node.id`,
    [secretId]
  );
  const eligible: Array<{ nodeId: string; label: string; alreadyGranted: boolean }> = [];
  const skipped: Array<{ nodeId: string; label: string; reason: string }> = [];
  for (const row of nodes.rows) {
    const nodeId = String(row.id);
    const label = String(row.code ?? row.label);
    if (row.deregistered_at || row.principal_status === "REVOKED") {
      skipped.push({ nodeId, label, reason: row.deregistered_at ? "COMPONENT_DEREGISTERED" : "PRINCIPAL_REVOKED" });
    } else {
      eligible.push({ nodeId, label, alreadyGranted: Boolean(row.direct_granted) });
    }
  }
  return {
    secretId,
    stableName: String(secret.rows[0].stable_name),
    secretStatus: String(secret.rows[0].status),
    eligibleCount: eligible.length,
    alreadyGrantedCount: eligible.filter((target) => target.alreadyGranted).length,
    createCount: eligible.filter((target) => !target.alreadyGranted).length,
    eligible,
    skipped
  };
}

export async function bulkGrantDashboardSecret(db: Db, input: { secretId: string; actorId: string; correlationId: string }) {
  const preview = await previewBulkDashboardSecret(db, input.secretId);
  const results: Array<{ nodeId: string; status: "CREATED" | "ALREADY_GRANTED" | "SKIPPED" | "FAILED"; reason?: string }> =
    preview.skipped.map((target) => ({ nodeId: target.nodeId, status: "SKIPPED", reason: target.reason }));
  for (const target of preview.eligible) {
    try {
      const result = await grantDashboardSecretToNode(db, { ...input, nodeId: target.nodeId });
      results.push({ nodeId: target.nodeId, status: result.status });
    } catch (error) {
      results.push({ nodeId: target.nodeId, status: "FAILED", reason: error instanceof Error ? error.message : "operation_failed" });
    }
  }
  return { secretId: input.secretId, targetCount: preview.eligibleCount, skippedCount: preview.skipped.length, results, correlationId: input.correlationId };
}

export async function revokeDashboardSecretFromNode(db: Db, input: { secretId: string; nodeId: string; actorId: string; correlationId: string }) {
  return tx(db, async (client) => {
    const node = await client.query(
      "select component_id from dashboard_visual_node where id=$1 and lifecycle_phase='REGISTERED' and deleted_at is null for update",
      [input.nodeId]
    );
    if (!node.rowCount) throw Object.assign(new Error("dashboard_registered_node_not_found"), { statusCode: 404 });
    const secret = await client.query("select stable_name from secret_record where id=$1", [input.secretId]);
    if (!secret.rowCount) throw Object.assign(new Error("not_found"), { statusCode: 404 });
    await client.query(
      `update secret_grant set revoked_at=coalesce(revoked_at,now()),revoked_by=$3
        where secret_id=$1 and principal_kind='COMPONENT' and principal_id=$2 and revoked_at is null`,
      [input.secretId, node.rows[0].component_id, input.actorId]
    );
    await appendAudit(client, {
      eventType: "dashboard.secret_grant.revoked", actorType: "admin", actorId: input.actorId,
      objectType: "secret", objectId: input.secretId, after: { nodeId: input.nodeId, stableName: secret.rows[0].stable_name }, correlationId: input.correlationId
    });
    return { nodeId: input.nodeId, secretId: input.secretId, revoked: true };
  });
}

export async function dashboardDeregistrationPreview(
  db: Db,
  nodeId: string
): Promise<Record<string, unknown> & { requiresMfa: true; typedConfirmation: string; requiresRegisteredComponent: true }> {
  const result = await db.query<Record<string, unknown>>(
    `select node.id node_id,component.id component_id,component.code,component.display_name,
      (select count(*) from principal_access_token token where token.source_principal_id=component.principal_id and token.revoked_at is null)::int token_count,
      (select count(*) from secret_grant grant_row where grant_row.principal_kind='COMPONENT' and grant_row.principal_id=component.id and grant_row.revoked_at is null)::int direct_secret_grant_count,
      (select count(*) from pulse_topology_connection edge where edge.revoked_at is null and (edge.source_component_id=component.id or edge.target_component_id=component.id))::int connection_count
      from dashboard_visual_node node join component component on component.id=node.component_id
      where node.id=$1 and node.lifecycle_phase='REGISTERED' and node.deleted_at is null`,
    [nodeId]
  );
  if (!result.rowCount) throw Object.assign(new Error("dashboard_registered_node_not_found"), { statusCode: 404 });
  const row = result.rows[0] ?? {};
  return { ...row, requiresMfa: true, typedConfirmation: String(row.code), requiresRegisteredComponent: true };
}

async function verifyDashboardDeregistrationReauthentication(
  db: Db,
  config: Pick<AppServerConfig, "MFA_ENCRYPTION_KEY_BASE64" | "MFA_ALLOW_PLAINTEXT_LEGACY">,
  input: { actorId: string; password: string; totp: string; nodeId: string; correlationId: string }
): Promise<void> {
  const account = await db.query(
    "select password_hash,mfa_enabled,mfa_secret,active from admin_account where id=$1",
    [input.actorId]
  );
  const row = account.rows[0];
  const passwordOk = Boolean(account.rowCount && row?.active && row?.password_hash)
    && await argon2.verify(String(row.password_hash), input.password);
  let mfaOk = false;
  if (passwordOk && row.mfa_enabled && row.mfa_secret) {
    const secret = decryptMfaSecret(String(row.mfa_secret), config.MFA_ENCRYPTION_KEY_BASE64, {
      allowLegacyPlaintext: config.MFA_ALLOW_PLAINTEXT_LEGACY,
      subjectId: input.actorId,
      purpose: "admin_totp"
    });
    mfaOk = authenticator.check(input.totp.trim(), secret);
  }
  if (!passwordOk || !mfaOk) {
    await appendAudit(db, {
      eventType: "dashboard.deregistration.reauthentication_failed",
      actorType: "admin",
      actorId: input.actorId,
      objectType: "dashboard_visual_node",
      objectId: input.nodeId,
      after: { passwordVerified: passwordOk, mfaVerified: mfaOk },
      correlationId: input.correlationId
    });
    throw Object.assign(new Error("reauthentication_failed"), { statusCode: 403 });
  }
}

export async function deregisterDashboardNode(
  db: Db,
  config: Pick<AppServerConfig, "MFA_ENCRYPTION_KEY_BASE64" | "MFA_ALLOW_PLAINTEXT_LEGACY">,
  input: {
    nodeId: string;
    actorId: string;
    password: string;
    totp: string;
    reason: string;
    confirmedCode: string;
    idempotencyKey: string;
    correlationId: string;
  }
): Promise<Record<string, unknown>> {
  const reason = input.reason.trim();
  const confirmedCode = input.confirmedCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (reason.length < 10 || reason.length > 1000) throw Object.assign(new Error("invalid_deregistration_reason"), { statusCode: 400 });
  if (!idempotencyKey || idempotencyKey.length > 200) throw Object.assign(new Error("invalid_idempotency_key"), { statusCode: 400 });
  await verifyDashboardDeregistrationReauthentication(db, config, input);

  const requestDigest = digest({ nodeId: input.nodeId, actorId: input.actorId, reason, confirmedCode });
  return tx(db, async (client) => {
    const previousRequest = await client.query(
      `select * from dashboard_deregistration_request where node_id=$1 and idempotency_key=$2 for update`,
      [input.nodeId, idempotencyKey]
    );
    if (previousRequest.rowCount) {
      if (String(previousRequest.rows[0].request_digest) !== requestDigest) {
        throw Object.assign(new Error("idempotency_key_reused_with_different_request"), { statusCode: 409 });
      }
      if (previousRequest.rows[0].status === "COMPLETED" && previousRequest.rows[0].result) {
        return previousRequest.rows[0].result as Record<string, unknown>;
      }
    }
    const node = await client.query(
      `select node.id,node.lifecycle_phase,node.deleted_at,node.component_id,node.principal_id,
              component.code,component.display_name,component.lifecycle_state,component.deregistered_at
         from dashboard_visual_node node
         join component component on component.id=node.component_id
        where node.id=$1 for update of node,component`,
      [input.nodeId]
    );
    if (!node.rowCount || node.rows[0].lifecycle_phase !== "REGISTERED") {
      throw Object.assign(new Error("dashboard_registered_node_not_found"), { statusCode: 404 });
    }
    const current = node.rows[0] as Record<string, unknown>;
    if (confirmedCode !== String(current.code)) throw Object.assign(new Error("deregistration_confirmation_mismatch"), { statusCode: 409 });

    if (!previousRequest.rowCount) {
      await client.query(
        `insert into dashboard_deregistration_request(node_id,idempotency_key,request_digest,actor_id,correlation_id)
         values ($1,$2,$3,$4,$5)`,
        [input.nodeId, idempotencyKey, requestDigest, input.actorId, input.correlationId]
      );
    }

    const componentId = String(current.component_id);
    const principalId = String(current.principal_id);
    const accessTokens = await client.query(
      `update principal_access_token set revoked_at=coalesce(revoked_at,now()),rotation_reason='DASHBOARD_DEREGISTRATION'
        where source_principal_id=$1 and revoked_at is null`,
      [principalId]
    );
    const principalCredentials = await client.query(
      `update principal_credential set revoked_at=coalesce(revoked_at,now()),revocation_epoch=revocation_epoch+1
        where principal_id=$1 and revoked_at is null`,
      [principalId]
    );
    const componentCredentials = await client.query(
      `update component_credential set status='REVOKED',revoked_at=coalesce(revoked_at,now())
        where component_id=$1 and revoked_at is null`,
      [componentId]
    );
    const legacyTokens = await client.query(
      `update component_access_token set revoked_at=coalesce(revoked_at,now())
        where source_component_id=$1 and revoked_at is null`,
      [componentId]
    );
    const externalTokens = await client.query(
      `update component_external_access_token set revoked_at=coalesce(revoked_at,now())
        where source_component_id=$1 and revoked_at is null`,
      [componentId]
    );
    const edges = await client.query(
      `update pulse_topology_connection
          set state='ARCHIVED',authorization_desired=false,revoked_at=coalesce(revoked_at,now()),
              revoked_by=$2,lock_version=lock_version+1
        where (source_component_id=$1 or target_component_id=$1) and revoked_at is null`,
      [componentId, input.actorId]
    );
    const permissions = await client.query(
      `update component_permission set revoked_at=coalesce(revoked_at,now())
        where (source_component_id=$1 or target_component_id=$1) and revoked_at is null`,
      [componentId]
    );
    const principalPermissions = await client.query(
      `update principal_component_permission set revoked_at=coalesce(revoked_at,now())
        where (source_principal_id=$1 or target_component_id=$2) and revoked_at is null`,
      [principalId, componentId]
    );
    const directGrants = await client.query(
      `update secret_grant set revoked_at=coalesce(revoked_at,now()),revoked_by=$2
        where principal_kind='COMPONENT' and principal_id=$1 and revoked_at is null`,
      [componentId, input.actorId]
    );
    await client.query(
      `update principal_permission_suspension set resumed_at=coalesce(resumed_at,now()),resumed_by=coalesce(resumed_by,$2)
        where principal_id=$1 and resumed_at is null`,
      [principalId, input.actorId]
    );
    await client.query(
      `update component
          set lifecycle_state='DEREGISTERED',activation_state='INACTIVE',operational_state='RETIRED',
              enabled=false,ingress_enabled=false,pulse_enabled=false,egress_enabled=false,
              retired_at=coalesce(retired_at,now()),deregistered_at=coalesce(deregistered_at,now()),
              policy_epoch=policy_epoch+1,lock_version=lock_version+1,updated_at=now()
        where id=$1`,
      [componentId]
    );
    await client.query(
      `update principal set status='REVOKED',policy_epoch=policy_epoch+1,revocation_epoch=revocation_epoch+1,updated_at=now()
        where id=$1`,
      [principalId]
    );
    await client.query(
      `update dashboard_visual_node
          set lifecycle_phase='DELETED',deleted_at=coalesce(deleted_at,now()),updated_at=now(),lock_version=lock_version+1
        where id=$1`,
      [input.nodeId]
    );

    const result = {
      nodeId: input.nodeId,
      componentId,
      componentCode: String(current.code),
      deregistered: true,
      requiresRegisteredComponent: true,
      cleanup: {
        accessTokens: accessTokens.rowCount ?? 0,
        principalCredentials: principalCredentials.rowCount ?? 0,
        componentCredentials: componentCredentials.rowCount ?? 0,
        legacyTokens: legacyTokens.rowCount ?? 0,
        externalTokens: externalTokens.rowCount ?? 0,
        connections: edges.rowCount ?? 0,
        componentPermissions: permissions.rowCount ?? 0,
        principalPermissions: principalPermissions.rowCount ?? 0,
        directSecretGrants: directGrants.rowCount ?? 0
      },
      correlationId: input.correlationId
    };
    await appendAudit(client, {
      eventType: "dashboard.component.deregistered",
      actorType: "admin",
      actorId: input.actorId,
      objectType: "component",
      objectId: componentId,
      before: {
        nodeId: input.nodeId,
        code: current.code,
        displayName: current.display_name,
        lifecycleState: current.lifecycle_state,
        deregisteredAt: current.deregistered_at
      },
      after: { ...result, reason, idempotencyKey },
      correlationId: input.correlationId
    });
    await client.query(
      `update dashboard_deregistration_request
          set status='COMPLETED',result=$3::jsonb,completed_at=now()
        where node_id=$1 and idempotency_key=$2`,
      [input.nodeId, idempotencyKey, JSON.stringify(result)]
    );
    return result;
  });
}

export async function listDashboardTopology(db: Db, adminId: string) {
  const currentWorkspace = await workspace(db, adminId);
  const [nodesResult, positionsResult, ports, edgeRows, secretRows, operationRows, eventRows] = await Promise.all([
    db.query(
      `select node.*,
              component.code,component.display_name,component.description,component.category,component.component_role,component.lifecycle_state,
              component.activation_state,component.operational_state,component.monitoring_state,component.recertification_state,
              component.enabled,component.ingress_enabled,component.pulse_enabled,component.egress_enabled,component.policy_epoch,
              component.active_revision_id,component.created_at component_created_at,component.updated_at component_updated_at,
              principal.status principal_status,suspension.id suspension_id,suspension.reason suspension_reason,
              access.fingerprint access_fingerprint,access.last_used_at access_last_used_at
         from dashboard_visual_node node
         left join component component on component.id=node.component_id
         left join principal principal on principal.id=node.principal_id
         left join principal_permission_suspension suspension on suspension.principal_id=node.principal_id and suspension.resumed_at is null
         left join lateral (
           select fingerprint,last_used_at from principal_access_token
            where source_principal_id=node.principal_id and revoked_at is null order by created_at desc limit 1
         ) access on true
        where node.deleted_at is null and node.lifecycle_phase='REGISTERED'
        order by node.label`
    ),
    db.query("select * from dashboard_node_position where workspace_id=$1", [currentWorkspace.id]),
    listPorts(db),
    db.query(
      `select edge.*,permission.revoked_at permission_revoked_at,suspension.id suspension_id,token_envelope.id token_envelope_id,
              source.code source_code,target.code target_code
         from pulse_topology_connection edge
         join component source on source.id=edge.source_component_id
         join component target on target.id=edge.target_component_id
         left join component_permission permission on permission.id=edge.permission_id
         left join principal_permission_suspension suspension on suspension.principal_id=source.principal_id and suspension.resumed_at is null
         left join lateral (
           select token.id from principal_access_token token
            where token.source_principal_id=source.principal_id and token.revoked_at is null and token.expires_at>now()
              and (token.target_component_id is null or token.target_component_id=edge.target_component_id)
              and (token.audience='*' or lower(token.audience)=lower(edge.audience))
              and ('*'=any(token.scope_names) or edge.target_scope=any(token.scope_names))
            order by token.created_at desc limit 1
         ) token_envelope on true
        where edge.revoked_at is null order by edge.created_at,edge.id`
    ),
    db.query(
      `select secret.id,secret.stable_name,secret.display_name,secret.description,secret.owner_kind,secret.owner_id,secret.status,
              secret.active_version_id,version.version_number,version.fingerprint,secret.lock_version,secret.deleted_at,
              (select count(*) from secret_grant direct_grant
                 where direct_grant.secret_id=secret.id and direct_grant.revoked_at is null)::int grant_count
         from secret_record secret
         left join secret_version version on version.id=secret.active_version_id
        order by secret.stable_name`
    ),
    db.query(
      `select component_id,count(*)::int call_count,
              count(*) filter(where success)::int success_count,
              count(*) filter(where not success)::int failure_count,
              max(occurred_at) last_run_at,
              max(occurred_at) filter(where not success) last_failure_at
         from component_operation_event where occurred_at >= now()-interval '24 hours' group by component_id`
    ),
    db.query(
      `select event.id,event.component_id,component.code,event.pulse_type,event.direction,event.operation_key,event.success,
              event.correlation_id,event.trace_id,event.occurred_at,event.received_at
         from component_operation_event event join component on component.id=event.component_id
        order by event.occurred_at desc limit 100`
    )
  ]);
  const positionByNode = new Map(positionsResult.rows.map((row) => [String(row.node_id), { x: Number(row.x), y: Number(row.y) }]));
  const operationByComponent = new Map(operationRows.rows.map((row) => [String(row.component_id), row]));
  const secretsByNode = new Map<string, Array<Record<string, unknown>>>();
  const grants = await db.query(
    `select node.id node_id,secret.id secret_id,secret.stable_name,secret.status,'DIRECT' source
       from dashboard_visual_node node
       join secret_grant grant_row on grant_row.principal_kind='COMPONENT' and grant_row.principal_id=node.component_id and grant_row.revoked_at is null
       join secret_record secret on secret.id=grant_row.secret_id
      where node.deleted_at is null and node.lifecycle_phase='REGISTERED'`
  );
  for (const row of grants.rows) {
    const key = String(row.node_id);
    const current = secretsByNode.get(key) ?? [];
    if (!current.some((item) => item.secretId === String(row.secret_id))) {
      current.push({ secretId: String(row.secret_id), stableName: String(row.stable_name), status: String(row.status), source: String(row.source) });
      secretsByNode.set(key, current);
    }
  }
  const nodes = nodesResult.rows.map((row, index) => {
    const componentId = row.component_id ? String(row.component_id) : null;
    const stats = componentId ? operationByComponent.get(componentId) : null;
    const identityUnavailable = false;
    const critical = ["UNHEALTHY", "QUARANTINED"].includes(String(row.operational_state)) || ["FAILED"].includes(String(row.monitoring_state));
    return {
      id: String(row.id), lifecyclePhase: "REGISTERED" as const, label: String(row.label),
      componentId, principalId: row.principal_id ? String(row.principal_id) : null,
      code: row.code ?? null, displayName: row.display_name ?? row.label, description: row.description ?? "",
      category: row.category ?? "COMPONENT", role: row.component_role ?? null,
      lifecycleState: row.lifecycle_state ?? "UNKNOWN", activationState: row.activation_state ?? "INACTIVE",
      operationalState: row.operational_state ?? "NOT_REGISTERED", monitoringState: row.monitoring_state ?? "NOT_CONFIGURED",
      recertificationState: row.recertification_state ?? "NOT_DUE", enabled: Boolean(row.enabled),
      runtimeAvailable: Boolean(row.enabled),
      identityUnavailable,
      suspended: Boolean(row.suspension_id), suspensionReason: row.suspension_reason ?? null,
      tokenFingerprint: row.access_fingerprint ?? row.token_fingerprint ?? null,
      tokenLastUsedAt: row.access_last_used_at ?? null,
      critical,
      position: positionByNode.get(String(row.id)) ?? { x: 60 + (index % 4) * 330, y: 80 + Math.floor(index / 4) * 280 },
      secrets: secretsByNode.get(String(row.id)) ?? [],
      statistics: {
        period: "24h", callCount: Number(stats?.call_count ?? 0), successCount: Number(stats?.success_count ?? 0),
        failureCount: Number(stats?.failure_count ?? 0), errorRate: Number(stats?.call_count ?? 0) ? Number(stats?.failure_count ?? 0) / Number(stats?.call_count ?? 0) : 0,
        lastRunAt: stats?.last_run_at ?? null, lastFailureAt: stats?.last_failure_at ?? null
      }
    };
  });
  const edges = edgeRows.rows.map((row) => ({
    id: String(row.id), sourceComponentId: String(row.source_component_id), sourcePortKey: String(row.source_port_key),
    targetComponentId: String(row.target_component_id), targetPortKey: String(row.target_port_key),
    route: String(row.target_route), scope: String(row.target_scope), audience: String(row.audience),
    compatibilityStatus: String(row.compatibility_status), compatibilityEvidence: row.compatibility_evidence,
    authorizationDesired: Boolean(row.authorization_desired),
    effectiveAuthorization: !row.authorization_desired || row.permission_revoked_at || row.suspension_id || !row.token_envelope_id ? "DENIED" : "GRANTED",
    authorizationReason: row.suspension_id ? "IDENTITY_SUSPENDED" : !row.authorization_desired ? "EDGE_PERMISSION_REVOKED" : row.permission_revoked_at ? "PERMISSION_REVOKED" : !row.token_envelope_id ? "TOKEN_SCOPE_OR_AUDIENCE_MISSING" : "PERMISSION_ACTIVE",
    sourceCode: String(row.source_code), targetCode: String(row.target_code), createdAt: row.created_at, correlationId: row.correlation_id
  }));
  const alarms = nodes.filter((node) => node.critical || node.suspended || node.identityUnavailable).map((node) => ({
    id: `node:${node.id}`,
    severity: node.critical ? "CRITICAL" : "HIGH",
    objectId: node.id,
    title: node.critical
      ? `${node.code ?? node.label}: kritický provozní stav`
      : node.identityUnavailable
        ? `${node.code ?? node.label}: onboardingová identita není použitelná`
        : `${node.code ?? node.label}: oprávnění pozastavena`,
    impact: node.critical
      ? `Provozní stav ${node.operationalState}, monitoring ${node.monitoringState}.`
      : node.identityUnavailable
        ? `Stav integračního tokenu: ${node.lifecycleState}. Runtime i nové Secret granty jsou fail-closed.`
        : "Směrová oprávnění a Secret resolve jsou fail-closed.",
    recommendedAction: "Otevřete detail prvku, ověřte audit a příčinu stavu.",
    occurredAt: node.statistics.lastFailureAt ?? null
  }));
  return {
    generatedAt: new Date().toISOString(),
    live: { source: "persisted_component_operation_event", connected: true, lastEventAt: eventRows.rows[0]?.occurred_at ?? null, stale: false },
    workspace: { id: String(currentWorkspace.id), viewport: currentWorkspace.viewport, lockVersion: Number(currentWorkspace.lock_version) },
    nodes, ports, edges,
    secrets: secretRows.rows.map((row) => ({
      id: String(row.id), stableName: String(row.stable_name), displayName: String(row.display_name), description: String(row.description),
      ownerKind: String(row.owner_kind), ownerId: row.owner_id ? String(row.owner_id) : null, status: String(row.status),
      version: row.version_number === null ? null : Number(row.version_number), fingerprint: row.fingerprint ?? null,
      expiresAt: null, grantCount: Number(row.grant_count ?? 0), lockVersion: Number(row.lock_version), deletedAt: row.deleted_at ?? null
    })),
    alarms,
    events: eventRows.rows.map((row) => ({
      id: String(row.id), componentId: String(row.component_id), componentCode: String(row.code), pulseType: row.pulse_type,
      direction: row.direction, operationKey: String(row.operation_key), success: Boolean(row.success),
      correlationId: String(row.correlation_id), traceId: row.trace_id ?? null, occurredAt: row.occurred_at, receivedAt: row.received_at
    }))
  };
}
