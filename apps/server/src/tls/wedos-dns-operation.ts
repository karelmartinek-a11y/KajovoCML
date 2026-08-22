import { createHash, randomUUID } from "node:crypto";
import { Resolver, resolve4, resolve6 } from "node:dns/promises";
import type pg from "pg";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit } from "../domain/audit.js";
import { parseWdnsRows, type WdnsRow, type WedosWapiClient } from "./wedos-wapi.js";

export const WEDOS_DNS_STATES = [
  "CREATED", "ROW_ADDED", "COMMITTED", "PROPAGATED", "CLEANUP_REQUESTED", "DELETED", "CLEANUP_PROPAGATED", "FAILED", "BLOCKED"
] as const;
export type WedosDnsOperationState = typeof WEDOS_DNS_STATES[number];
export type WedosDnsPurpose = "ACME" | "PREFLIGHT_TEST";

type SqlExecutor = Db | pg.PoolClient;

export type WedosDnsOperation = Readonly<{
  id: string;
  provider: "WEDOS_WAPI";
  purpose: WedosDnsPurpose;
  correlationId: string;
  zone: string;
  recordName: string;
  recordType: "TXT";
  valueDigest: string;
  authorComment: string;
  wedosRowId: string | null;
  state: WedosDnsOperationState;
  attemptCount: number;
  lastSafeErrorCode: string | null;
}>;

export type AuthoritativeTxtResolver = (zone: string, recordName: string, value: string, expectedPresent: boolean) => Promise<void>;
export type WedosDnsApi = Pick<WedosWapiClient, "rowsList" | "rowAdd" | "rowDelete" | "domainCommit">;

export function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function operationAuthorComment(purpose: WedosDnsPurpose, correlationId: string = randomUUID()): string {
  // WEDOS accepts a restricted author_comment alphabet. Keep the ownership
  // marker correlation-specific using ASCII alphanumerics only.
  const compactCorrelationId = correlationId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compactCorrelationId)) throw new Error("wedos_dns_correlation_id_invalid");
  return `kcml${purpose === "ACME" ? "acme" : "wapitest"}${compactCorrelationId}`;
}

function parseAuthorComment(value: string, purpose: WedosDnsPurpose): boolean {
  return new RegExp(`^kcml${purpose === "ACME" ? "acme" : "wapitest"}[0-9a-f]{32}$`).test(value);
}

function normalizeZone(value: string): string {
  const zone = value.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(zone)) throw new Error("wedos_dns_zone_invalid");
  return zone;
}

function normalizeRecordName(value: string): string {
  const recordName = value.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(recordName)) throw new Error("wedos_dns_record_name_invalid");
  return recordName;
}

function operationFromRow(row: Record<string, unknown>): WedosDnsOperation {
  const rowId = row.wedos_row_id === null || row.wedos_row_id === undefined ? null : row.wedos_row_id as string;
  const safeError = row.last_safe_error_code === null || row.last_safe_error_code === undefined ? null : row.last_safe_error_code as string;
  return {
    id: String(row.id), provider: "WEDOS_WAPI", purpose: String(row.purpose) as WedosDnsPurpose,
    correlationId: String(row.correlation_id), zone: String(row.zone), recordName: String(row.record_name), recordType: "TXT",
    valueDigest: String(row.value_digest), authorComment: String(row.author_comment), wedosRowId: rowId ? rowId.toUpperCase() : null,
    state: String(row.state) as WedosDnsOperationState, attemptCount: Number(row.attempt_count),
    lastSafeErrorCode: safeError
  };
}

const operationSelect = `
  select id,provider,purpose,correlation_id,zone,record_name,record_type,value_digest,author_comment,
         wedos_row_id,state,attempt_count,last_safe_error_code
    from wedos_dns_operation`;

async function getOperation(executor: SqlExecutor, id: string, forUpdate = false): Promise<WedosDnsOperation> {
  const result = await executor.query(`${operationSelect} where id=$1${forUpdate ? " for update" : ""}`, [id]);
  if (!result.rowCount) throw Object.assign(new Error("wedos_dns_operation_not_found"), { statusCode: 404 });
  return operationFromRow(result.rows[0]);
}

export async function getWedosDnsOperation(db: Db, id: string): Promise<WedosDnsOperation> {
  return getOperation(db, id);
}

export async function createWedosDnsOperation(db: Db, input: Readonly<{
  purpose: WedosDnsPurpose;
  zone: string;
  recordName: string;
  value: string;
  correlationId?: string;
}>): Promise<WedosDnsOperation> {
  const zone = normalizeZone(input.zone);
  const recordName = normalizeRecordName(input.recordName);
  const correlationId = input.correlationId ?? randomUUID();
  const authorComment = operationAuthorComment(input.purpose, correlationId);
  if (!parseAuthorComment(authorComment, input.purpose)) throw new Error("wedos_dns_author_comment_invalid");
  return tx(db, async (client) => {
    const result = await client.query(
      `insert into wedos_dns_operation(purpose,correlation_id,zone,record_name,record_type,value_digest,author_comment)
       values ($1,$2,$3,$4,'TXT',$5,$6) returning id,provider,purpose,correlation_id,zone,record_name,record_type,value_digest,author_comment,wedos_row_id,state,attempt_count,last_safe_error_code`,
      [input.purpose, correlationId, zone, recordName, sha256Digest(input.value), authorComment]
    );
    const operation = operationFromRow(result.rows[0]);
    await appendAudit(client, {
      eventType: "wedos.dns.operation.created", actorType: "platform", actorId: "platform-worker",
      objectType: "wedos_dns_operation", objectId: operation.id,
      after: { purpose: operation.purpose, zone: operation.zone, recordName: operation.recordName, valueDigest: operation.valueDigest, authorComment: operation.authorComment },
      correlationId: operation.correlationId
    });
    return operation;
  });
}

async function withOperationLock<T>(db: Db, operationId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1,0))", [`wedos-dns-operation:${operationId}`]);
    return await fn(client);
  } finally {
    await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [`wedos-dns-operation:${operationId}`]).catch(() => undefined);
    client.release();
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "number") return `wapi_${String(error.code)}`;
  const message = error instanceof Error ? error.message : "unknown";
  return message.replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120) || "unknown";
}

async function recordAttempt(client: pg.PoolClient, operationId: string): Promise<void> {
  await client.query("update wedos_dns_operation set attempt_count=attempt_count+1,last_safe_error_code=null,updated_at=now() where id=$1 and state not in ('CLEANUP_PROPAGATED','FAILED','BLOCKED')", [operationId]);
}

async function recordSafeError(client: pg.PoolClient, operationId: string, error: unknown): Promise<void> {
  await client.query("update wedos_dns_operation set last_safe_error_code=$2,updated_at=now() where id=$1 and state not in ('CLEANUP_PROPAGATED','FAILED','BLOCKED')", [operationId, safeErrorCode(error)]);
}

function exactOwnedRows(operation: WedosDnsOperation, rows: WdnsRow[], value: string): WdnsRow[] {
  return rows.filter((row) => row.name === operation.recordName && row.rdtype === "TXT" && row.rdata === value && row.authorComment === operation.authorComment);
}

async function listExactOwnedRow(api: WedosDnsApi, operation: WedosDnsOperation, value: string): Promise<WdnsRow | null> {
  if (sha256Digest(value) !== operation.valueDigest) throw new Error("wedos_dns_value_digest_mismatch");
  const response = await api.rowsList(operation.zone);
  const rows = parseWdnsRows(response.data);
  const owned = exactOwnedRows(operation, rows, value);
  if (owned.length > 1) throw new Error("wedos_dns_owned_row_ambiguous");
  return owned[0] ?? null;
}

async function updateState(client: pg.PoolClient, operationId: string, expected: WedosDnsOperationState[], next: WedosDnsOperationState, extra = ""): Promise<void> {
  const result = await client.query(
    `update wedos_dns_operation set state=$2,updated_at=now(),
       committed_at=case when $2='COMMITTED' then now() else committed_at end,
       propagated_at=case when $2='PROPAGATED' then now() else propagated_at end,
       cleanup_requested_at=case when $2='CLEANUP_REQUESTED' then now() else cleanup_requested_at end,
       deleted_at=case when $2='DELETED' then now() else deleted_at end,
       cleanup_propagated_at=case when $2='CLEANUP_PROPAGATED' then now() else cleanup_propagated_at end
       ${extra}
     where id=$1 and state=any($3::text[])`,
    [operationId, next, expected]
  );
  if (!result.rowCount) {
    const current = await getOperation(client, operationId);
    if (current.state === next) return;
    throw new Error(`wedos_dns_invalid_transition:${current.state}->${next}`);
  }
}

export async function addTxtRow(db: Db, operationId: string, value: string, api: WedosDnsApi): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    const operation = await getOperation(client, operationId, true);
    if (["ROW_ADDED", "COMMITTED", "PROPAGATED", "CLEANUP_REQUESTED", "DELETED", "CLEANUP_PROPAGATED"].includes(operation.state)) return operation;
    if (operation.state !== "CREATED") throw new Error(`wedos_dns_add_not_allowed:${operation.state}`);
    await recordAttempt(client, operationId);
    try {
      let owned = await listExactOwnedRow(api, operation, value);
      if (!owned) {
        await api.rowAdd(operation.zone, operation.recordName, value, operation.authorComment, 300);
        owned = await listExactOwnedRow(api, operation, value);
      }
      if (!owned) throw new Error("wedos_dns_owned_row_not_visible_after_add");
      await client.query("update wedos_dns_operation set wedos_row_id=$2,state='ROW_ADDED',updated_at=now() where id=$1 and state='CREATED'", [operationId, owned.id.toUpperCase()]);
      return getOperation(client, operationId);
    } catch (error) {
      await recordSafeError(client, operationId, error);
      throw error;
    }
  });
}

export async function commitDnsOperation(db: Db, operationId: string, value: string, api: WedosDnsApi): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    const operation = await getOperation(client, operationId, true);
    if (["COMMITTED", "PROPAGATED", "CLEANUP_REQUESTED", "DELETED", "CLEANUP_PROPAGATED"].includes(operation.state)) return operation;
    if (operation.state !== "ROW_ADDED") throw new Error(`wedos_dns_commit_not_allowed:${operation.state}`);
    await recordAttempt(client, operationId);
    try {
      const owned = await listExactOwnedRow(api, operation, value);
      if (!owned || !operation.wedosRowId || owned.id.toUpperCase() !== operation.wedosRowId.toUpperCase()) throw new Error("wedos_dns_owned_row_revalidation_failed");
      await api.domainCommit(operation.zone);
      await updateState(client, operationId, ["ROW_ADDED"], "COMMITTED");
      return getOperation(client, operationId);
    } catch (error) {
      await recordSafeError(client, operationId, error);
      throw error;
    }
  });
}

function fqdn(zone: string, recordName: string): string {
  return `${recordName}.${zone}.`;
}

async function authoritativeNameServerAddresses(authority: string): Promise<string[]> {
  const host = authority.replace(/\.$/, "");
  const ipv4 = await resolve4(host).catch(() => [] as string[]);
  const ipv6 = await resolve6(host).catch(() => [] as string[]);
  const addresses = [...ipv4, ...ipv6];
  if (!addresses.length) throw new Error(`wedos_dns_authoritative_nameserver_resolution_failed:${host}`);
  return [...new Set(addresses)];
}

function isRetryableAuthoritativeNetworkError(code: string): boolean {
  return ["ECONNREFUSED", "ETIMEDOUT", "ETIME", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"].includes(code);
}

const AUTHORITATIVE_PROPAGATION_ATTEMPTS = 20;
const AUTHORITATIVE_PROPAGATION_DELAY_MS = 3_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyAuthoritativeTxt(zoneInput: string, recordNameInput: string, value: string, expectedPresent: boolean): Promise<void> {
  const zone = normalizeZone(zoneInput); const recordName = normalizeRecordName(recordNameInput);
  const authorities = await Resolver.prototype.resolveNs.call(new Resolver(), `${zone}.`);
  if (!authorities.length) throw new Error("wedos_dns_authoritative_nameservers_missing");
  const target = fqdn(zone, recordName);
  for (const authority of authorities) {
    const addresses = await authoritativeNameServerAddresses(authority);
    let responded = false;
    let lastNetworkError = "unknown";
    for (const address of addresses) {
      const resolver = new Resolver(); resolver.setServers([address]);
      let records: string[][] = [];
      try {
        records = await resolver.resolveTxt(target);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (!expectedPresent && ["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(code)) records = [];
        else if (isRetryableAuthoritativeNetworkError(code)) {
          lastNetworkError = code || "unknown";
          continue;
        } else throw new Error(`wedos_dns_authoritative_query_failed:${authority}:${address}:${code || "unknown"}`);
      }
      responded = true;
      const present = records.some((record) => record.join("") === value);
      if (present !== expectedPresent) throw new Error(`wedos_dns_authoritative_visibility_mismatch:${authority}:${address}`);
      break;
    }
    if (!responded) throw new Error(`wedos_dns_authoritative_query_failed:${authority}:${lastNetworkError}`);
  }
}

export async function waitForAuthoritativeTxt(zone: string, recordName: string, value: string, expectedPresent: boolean): Promise<void> {
  let lastError: unknown = new Error("wedos_dns_authoritative_propagation_unknown");
  for (let attempt = 1; attempt <= AUTHORITATIVE_PROPAGATION_ATTEMPTS; attempt += 1) {
    try {
      await verifyAuthoritativeTxt(zone, recordName, value, expectedPresent);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === AUTHORITATIVE_PROPAGATION_ATTEMPTS) break;
      await sleep(AUTHORITATIVE_PROPAGATION_DELAY_MS);
    }
  }
  throw new Error(`wedos_dns_authoritative_propagation_timeout:${lastError instanceof Error ? lastError.message : "unknown"}`);
}

export async function markPropagated(db: Db, operationId: string, value: string, api: WedosDnsApi, resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    const operation = await getOperation(client, operationId, true);
    if (["PROPAGATED", "CLEANUP_REQUESTED", "DELETED", "CLEANUP_PROPAGATED"].includes(operation.state)) return operation;
    if (operation.state !== "COMMITTED") throw new Error(`wedos_dns_propagation_not_allowed:${operation.state}`);
    await recordAttempt(client, operationId);
    try {
      await resolver(operation.zone, operation.recordName, value, true);
      await updateState(client, operationId, ["COMMITTED"], "PROPAGATED");
      return getOperation(client, operationId);
    } catch (error) {
      await recordSafeError(client, operationId, error);
      throw error;
    }
  });
}

export async function runDnsOperation(db: Db, input: Readonly<{ purpose: WedosDnsPurpose; zone: string; recordName: string; value: string }>, api: WedosDnsApi, resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt): Promise<WedosDnsOperation> {
  const created = await createWedosDnsOperation(db, input);
  await addTxtRow(db, created.id, input.value, api);
  await commitDnsOperation(db, created.id, input.value, api);
  return markPropagated(db, created.id, input.value, api, resolver);
}

export async function cleanupDnsOperation(db: Db, operationId: string, value: string, api: WedosDnsApi, resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    let operation = await getOperation(client, operationId, true);
    if (operation.state === "CLEANUP_PROPAGATED") return operation;
    if (!["PROPAGATED", "COMMITTED", "CLEANUP_REQUESTED", "DELETED"].includes(operation.state)) throw new Error(`wedos_dns_cleanup_not_allowed:${operation.state}`);
    await recordAttempt(client, operationId);
    try {
      if (operation.state === "PROPAGATED" || operation.state === "COMMITTED") {
        await updateState(client, operationId, ["PROPAGATED", "COMMITTED"], "CLEANUP_REQUESTED");
        operation = await getOperation(client, operationId, true);
      }
      if (operation.state === "CLEANUP_REQUESTED") {
        const owned = await listExactOwnedRow(api, operation, value);
        if (owned) {
          if (!operation.wedosRowId || owned.id.toUpperCase() !== operation.wedosRowId.toUpperCase()) throw new Error("wedos_dns_cleanup_row_ownership_mismatch");
          await api.rowDelete(operation.zone, owned.id.toUpperCase());
          const afterDelete = await listExactOwnedRow(api, operation, value);
          if (afterDelete) throw new Error("wedos_dns_owned_row_still_present_after_delete");
          await api.domainCommit(operation.zone);
        }
        await updateState(client, operationId, ["CLEANUP_REQUESTED"], "DELETED");
        operation = await getOperation(client, operationId, true);
      }
      if (operation.state === "DELETED") {
        await resolver(operation.zone, operation.recordName, value, false);
        await updateState(client, operationId, ["DELETED"], "CLEANUP_PROPAGATED");
      }
      return getOperation(client, operationId);
    } catch (error) {
      await recordSafeError(client, operationId, error);
      throw error;
    }
  });
}

export async function recoverDnsOperation(db: Db, operationId: string, value: string, api: WedosDnsApi, resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt): Promise<WedosDnsOperation> {
  const operation = await getWedosDnsOperation(db, operationId);
  if (["CREATED", "ROW_ADDED"].includes(operation.state)) {
    await addTxtRow(db, operationId, value, api);
  }
  const afterAdd = await getWedosDnsOperation(db, operationId);
  if (afterAdd.state === "ROW_ADDED") await commitDnsOperation(db, operationId, value, api);
  const afterCommit = await getWedosDnsOperation(db, operationId);
  if (afterCommit.state === "COMMITTED") await markPropagated(db, operationId, value, api, resolver);
  return getWedosDnsOperation(db, operationId);
}

export function findOperationIdInAuthOutput(output: string | undefined): string {
  const match = output?.match(/(?:^|\n)kcml-operation-id=([0-9a-f-]{36})(?:\n|$)/i);
  if (!match) throw new Error("wedos_acme_operation_id_missing");
  return match[1]!;
}
