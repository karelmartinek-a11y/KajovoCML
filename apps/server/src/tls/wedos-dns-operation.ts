import { createHash, randomUUID } from "node:crypto";
import { Resolver } from "node:dns/promises";
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

export type AuthoritativeTxtResolver = (zone: string, recordName: string, value: string, expectedPresent: boolean, baseline?: AuthoritativeDnsSnapshot) => Promise<void>;
export type WedosDnsApi = Pick<WedosWapiClient, "rowsList" | "rowAdd" | "rowDelete" | "domainCommit">;

export type AuthoritativeDnsObservation = Readonly<{
  authority: string; address: string; response: "OK" | "NETWORK_FAILURE" | "PROTOCOL_FAILURE";
  soaStatus: "AVAILABLE" | "NETWORK_FAILURE" | "PROTOCOL_FAILURE";
  soaSerial: string | null; expectedTxtPresent: boolean | null;
}>;
export type AuthoritativeDnsSnapshot = Readonly<{ zone: string; elapsedSeconds: number; observations: AuthoritativeDnsObservation[] }>;
export type AuthoritativeDnsEvaluation = "PASS" | "STILL_PROPAGATING" | "PROVIDER_REPLICA_DIVERGENCE" | "WAPI_AUTHORITATIVE_DIVERGENCE" | "NETWORK_FAILURE" | "PROTOCOL_FAILURE";

export class WedosDnsObservationError extends Error {
  constructor(
    readonly snapshot: AuthoritativeDnsSnapshot,
    readonly evaluation: AuthoritativeDnsEvaluation,
    readonly baseline?: AuthoritativeDnsSnapshot,
    readonly expectedPresent = true
  ) {
    super(`wedos_dns_authoritative_${evaluation.toLowerCase()}`);
  }
}

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

function boundedPositiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 250 || value > maximum) throw new Error(`${name.toLowerCase()}_invalid`);
  return value;
}

// These are KCML operational limits, not a WEDOS propagation SLA. Production
// evidence on 2026-08-23 showed an exact WAPI deletion still visible on every
// healthy authority after 317 seconds and absent before eight minutes. The
// query timeout remains independent, otherwise one unreachable IPv6 endpoint
// can consume the whole propagation deadline before another authority is seen.
const AUTHORITATIVE_DNS_QUERY_TIMEOUT_MS = boundedPositiveInteger("WEDOS_DNS_QUERY_TIMEOUT_MS", 3_000, 15_000);
const AUTHORITATIVE_PROPAGATION_TIMEOUT_MS = boundedPositiveInteger("WEDOS_DNS_PROPAGATION_TIMEOUT_MS", 480_000, 900_000);
const AUTHORITATIVE_PROPAGATION_DELAY_MS = 5_000;

function dnsTimeoutError(): Error & { code: string } {
  return Object.assign(new Error("wedos_dns_query_timeout"), { code: "ETIMEDOUT" });
}

async function boundedDnsQuery<T>(resolver: Resolver, query: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      query(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          resolver.cancel();
          reject(dnsTimeoutError());
        }, AUTHORITATIVE_DNS_QUERY_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function observationFailure(code: string): "NETWORK_FAILURE" | "PROTOCOL_FAILURE" {
  return isRetryableAuthoritativeNetworkError(code) ? "NETWORK_FAILURE" : "PROTOCOL_FAILURE";
}

async function defaultDnsQuery<T>(query: (resolver: Resolver) => Promise<T>): Promise<T> {
  const resolver = new Resolver();
  return boundedDnsQuery(resolver, () => query(resolver));
}

async function authoritativeNameServerAddresses(authority: string): Promise<string[]> {
  const host = authority.replace(/\.$/, "");
  const [ipv4, ipv6] = await Promise.all([
    defaultDnsQuery((resolver) => resolver.resolve4(host)).catch(() => [] as string[]),
    defaultDnsQuery((resolver) => resolver.resolve6(host)).catch(() => [] as string[])
  ]);
  const addresses = [...ipv4, ...ipv6];
  if (!addresses.length) throw new Error(`wedos_dns_authoritative_nameserver_resolution_failed:${host}`);
  return [...new Set(addresses)];
}

async function authoritativeNameservers(zone: string): Promise<string[]> {
  const authorities = await defaultDnsQuery((resolver) => resolver.resolveNs(`${zone}.`));
  if (!authorities.length) throw new Error("wedos_dns_authoritative_nameservers_missing");
  return authorities;
}

async function authoritativeTxtValues(zoneInput: string, recordNameInput: string): Promise<string[]> {
  const zone = normalizeZone(zoneInput); const recordName = normalizeRecordName(recordNameInput);
  const authorities = await authoritativeNameservers(zone);
  const target = fqdn(zone, recordName);
  const values: string[] = [];
  for (const authority of authorities) {
    const addresses = await authoritativeNameServerAddresses(authority);
    let responded = false;
    let lastNetworkError = "unknown";
    for (const address of addresses) {
      const resolver = new Resolver(); resolver.setServers([address]);
      let records: string[][] = [];
      try {
        records = await boundedDnsQuery(resolver, () => resolver.resolveTxt(target));
      } catch (error) {
        const code = errorCode(error);
        if (["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(code)) records = [];
        else if (isRetryableAuthoritativeNetworkError(code)) {
          lastNetworkError = code || "unknown";
          continue;
        } else throw new Error(`wedos_dns_authoritative_query_failed:${authority}:${address}:${code || "unknown"}`);
      }
      responded = true;
      values.push(...records.map((record) => record.join("")));
      break;
    }
    if (!responded) throw new Error(`wedos_dns_authoritative_query_failed:${authority}:${lastNetworkError}`);
  }
  return [...new Set(values)];
}

export async function observeAuthoritativeDns(zoneInput: string, recordNameInput: string, value: string, startedAt = Date.now()): Promise<AuthoritativeDnsSnapshot> {
  const zone = normalizeZone(zoneInput); const recordName = normalizeRecordName(recordNameInput);
  const authorities = await authoritativeNameservers(zone);
  const target = fqdn(zone, recordName);
  const observations: AuthoritativeDnsObservation[] = [];
  for (const authority of authorities) {
    const addresses = await authoritativeNameServerAddresses(authority);
    for (const address of addresses) {
      const soaResolver = new Resolver(); soaResolver.setServers([address]);
      const txtResolver = new Resolver(); txtResolver.setServers([address]);
      const soaPromise = boundedDnsQuery(soaResolver, () => soaResolver.resolveSoa(`${zone}.`));
      const txtPromise = boundedDnsQuery(txtResolver, () => txtResolver.resolveTxt(target));
      try {
        const [soaResult, txtResult] = await Promise.allSettled([soaPromise, txtPromise]);
        const soaStatus = soaResult.status === "fulfilled" ? "AVAILABLE" : observationFailure(errorCode(soaResult.reason));
        const soaSerial = soaResult.status === "fulfilled" ? String(soaResult.value.serial) : null;
        if (txtResult.status === "rejected") {
          const code = errorCode(txtResult.reason);
          if (["ENODATA", "ENOTFOUND", "NXDOMAIN"].includes(code)) {
            observations.push({ authority, address, response: "OK", soaStatus, soaSerial, expectedTxtPresent: false });
          } else {
            observations.push({ authority, address, response: observationFailure(code), soaStatus, soaSerial, expectedTxtPresent: null });
          }
        } else {
          observations.push({ authority, address, response: "OK", soaStatus, soaSerial, expectedTxtPresent: txtResult.value.some((record) => record.join("") === value) });
        }
      } catch (error) {
        observations.push({ authority, address, response: observationFailure(errorCode(error)), soaStatus: "PROTOCOL_FAILURE", soaSerial: null, expectedTxtPresent: null });
      }
    }
  }
  return { zone, elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)), observations };
}

function baselineSerial(baseline: AuthoritativeDnsSnapshot | undefined, observation: AuthoritativeDnsObservation): string | null {
  return baseline?.observations.find((item) => item.authority === observation.authority && item.address === observation.address)?.soaSerial ?? null;
}

export function evaluateAuthoritativeTxtSnapshot(snapshot: AuthoritativeDnsSnapshot, expectedPresent: boolean, baseline?: AuthoritativeDnsSnapshot): AuthoritativeDnsEvaluation {
  if (!snapshot.observations.length) return "NETWORK_FAILURE";
  const byAuthority = new Map<string, AuthoritativeDnsObservation[]>();
  for (const observation of snapshot.observations) {
    const grouped = byAuthority.get(observation.authority) ?? [];
    grouped.push(observation);
    byAuthority.set(observation.authority, grouped);
  }
  for (const observations of byAuthority.values()) {
    if (observations.some((item) => item.response === "PROTOCOL_FAILURE")) return "PROTOCOL_FAILURE";
    if (!observations.some((item) => item.response === "OK")) return "NETWORK_FAILURE";
  }
  const successful = snapshot.observations.filter((item) => item.response === "OK");
  if (successful.some((item) => item.soaStatus === "PROTOCOL_FAILURE")) return "PROTOCOL_FAILURE";
  if (successful.some((item) => item.soaStatus === "NETWORK_FAILURE")) return "NETWORK_FAILURE";
  if (successful.every((item) => item.expectedTxtPresent === expectedPresent)) return "PASS";

  const mismatches = successful.filter((item) => item.expectedTxtPresent !== expectedPresent);
  const serials = new Set(successful.map((item) => item.soaSerial).filter((serial): serial is string => Boolean(serial)));
  const baselineSerials = mismatches.map((item) => baselineSerial(baseline, item)).filter((serial): serial is string => Boolean(serial));
  const hasBaselineStaleReplica = mismatches.some((item) => {
    const serial = baselineSerial(baseline, item);
    return Boolean(serial && serial === item.soaSerial);
  });

  if (hasBaselineStaleReplica) {
    if (mismatches.length !== successful.length || serials.size > 1 || new Set(baselineSerials).size > 1) return "PROVIDER_REPLICA_DIVERGENCE";
    return "STILL_PROPAGATING";
  }
  if (serials.size > 1) return "PROVIDER_REPLICA_DIVERGENCE";
  return expectedPresent ? "WAPI_AUTHORITATIVE_DIVERGENCE" : "STILL_PROPAGATING";
}

export function safeAuthoritativeDnsDiagnostics(snapshot: AuthoritativeDnsSnapshot, baseline?: AuthoritativeDnsSnapshot, expectedPresent = true): string[] {
  const serials = new Set(snapshot.observations.map((item) => item.soaSerial).filter((serial): serial is string => Boolean(serial)));
  const byAuthority = new Map<string, AuthoritativeDnsObservation[]>();
  for (const observation of snapshot.observations) {
    const observations = byAuthority.get(observation.authority) ?? [];
    observations.push(observation);
    byAuthority.set(observation.authority, observations);
  }
  const readyAuthorities = [...byAuthority.values()].filter((observations) => observations.some((item) =>
    item.response === "OK" && item.soaStatus === "AVAILABLE" && item.expectedTxtPresent === expectedPresent
  )).length;
  const readyAddresses = snapshot.observations.filter((item) =>
    item.response === "OK" && item.soaStatus === "AVAILABLE" && item.expectedTxtPresent === expectedPresent
  ).length;
  return [
    `wedos-dns:zone=${snapshot.zone}`,
    ...snapshot.observations.map((item) => `wedos-dns:authority:host=${item.authority}:address=${item.address}:response=${item.response}:baselineSoaSerial=${baselineSerial(baseline, item) ?? "unknown"}:soaStatus=${item.soaStatus}:soaSerial=${item.soaSerial ?? "unknown"}:txtExpectedPresent=${item.expectedTxtPresent === null ? "unknown" : item.expectedTxtPresent ? "yes" : "no"}`),
    `wedos-dns:serials-converged=${serials.size <= 1 ? "yes" : "no"}`,
    `wedos-dns:authorities-ready=${readyAuthorities}/${byAuthority.size}`,
    `wedos-dns:addresses-ready=${readyAddresses}/${snapshot.observations.length}`,
    `wedos-dns:elapsedSeconds=${snapshot.elapsedSeconds}`
  ];
}

function isRetryableAuthoritativeNetworkError(code: string): boolean {
  return ["ECONNREFUSED", "ETIMEDOUT", "ETIME", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"].includes(code);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyAuthoritativeTxt(zoneInput: string, recordNameInput: string, value: string, expectedPresent: boolean): Promise<void> {
  const snapshot = await observeAuthoritativeDns(zoneInput, recordNameInput, value);
  const evaluation = evaluateAuthoritativeTxtSnapshot(snapshot, expectedPresent);
  if (evaluation !== "PASS") throw new WedosDnsObservationError(snapshot, evaluation, undefined, expectedPresent);
}

/**
 * Finds the value represented by a persisted digest without exposing it in
 * logs or durable state. This is used only after a WEDOS row has already been
 * deleted and a worker must recover the authoritative cleanup verification.
 */
export async function findAuthoritativeTxtByDigest(zone: string, recordName: string, valueDigest: string): Promise<string | null> {
  const values = await authoritativeTxtValues(zone, recordName);
  return values.find((value) => sha256Digest(value) === valueDigest) ?? null;
}

export async function waitForAuthoritativeTxt(zone: string, recordName: string, value: string, expectedPresent: boolean, baseline?: AuthoritativeDnsSnapshot): Promise<void> {
  let lastError: unknown = new Error("wedos_dns_authoritative_propagation_unknown");
  const startedAt = Date.now();
  while (Date.now() - startedAt < AUTHORITATIVE_PROPAGATION_TIMEOUT_MS) {
    try {
      const snapshot = await observeAuthoritativeDns(zone, recordName, value, startedAt);
      const evaluation = evaluateAuthoritativeTxtSnapshot(snapshot, expectedPresent, baseline);
      if (evaluation !== "PASS") throw new WedosDnsObservationError(snapshot, evaluation, baseline, expectedPresent);
      return;
    } catch (error) {
      lastError = error;
      const remaining = AUTHORITATIVE_PROPAGATION_TIMEOUT_MS - (Date.now() - startedAt);
      if (remaining <= 0) break;
      await sleep(Math.min(AUTHORITATIVE_PROPAGATION_DELAY_MS, remaining));
    }
  }
  // Preserve the last structured observation across the bounded retry loop.
  // The deploy caller must be able to distinguish a provider replica lag from
  // a transport failure without ever receiving the TXT value itself.
  if (lastError instanceof WedosDnsObservationError) throw lastError;
  throw new Error(`wedos_dns_authoritative_propagation_timeout:${lastError instanceof Error ? lastError.message : "unknown"}`);
}

export async function markPropagated(
  db: Db,
  operationId: string,
  value: string,
  api: WedosDnsApi,
  resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt,
  baseline?: AuthoritativeDnsSnapshot
): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    const operation = await getOperation(client, operationId, true);
    if (["PROPAGATED", "CLEANUP_REQUESTED", "DELETED", "CLEANUP_PROPAGATED"].includes(operation.state)) return operation;
    if (operation.state !== "COMMITTED") throw new Error(`wedos_dns_propagation_not_allowed:${operation.state}`);
    await recordAttempt(client, operationId);
    try {
      await resolver(operation.zone, operation.recordName, value, true, baseline);
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
  try {
    const baseline = await observeAuthoritativeDns(created.zone, created.recordName, input.value);
    await addTxtRow(db, created.id, input.value, api);
    await commitDnsOperation(db, created.id, input.value, api);
    return markPropagated(db, created.id, input.value, api, resolver, baseline);
  } catch (error) {
    const current = await getWedosDnsOperation(db, created.id);
    if (current.state === "CREATED") await failWedosDnsOperation(db, created.id, error);
    throw error;
  }
}

export async function cleanupDnsOperation(db: Db, operationId: string, value: string, api: WedosDnsApi, resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    let operation = await getOperation(client, operationId, true);
    if (operation.state === "CLEANUP_PROPAGATED") return operation;
    if (!["ROW_ADDED", "PROPAGATED", "COMMITTED", "CLEANUP_REQUESTED", "DELETED"].includes(operation.state)) throw new Error(`wedos_dns_cleanup_not_allowed:${operation.state}`);
    await recordAttempt(client, operationId);
    try {
      let cleanupBaseline: AuthoritativeDnsSnapshot | undefined;
      if (operation.state === "ROW_ADDED" || operation.state === "PROPAGATED" || operation.state === "COMMITTED") {
        cleanupBaseline = await observeAuthoritativeDns(operation.zone, operation.recordName, value);
        await updateState(client, operationId, ["ROW_ADDED", "PROPAGATED", "COMMITTED"], "CLEANUP_REQUESTED");
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
        await resolver(operation.zone, operation.recordName, value, false, cleanupBaseline);
        await updateState(client, operationId, ["DELETED"], "CLEANUP_PROPAGATED");
      }
      return getOperation(client, operationId);
    } catch (error) {
      await recordSafeError(client, operationId, error);
      throw error;
    }
  });
}

/**
 * Recover an interrupted operation without persisting or logging the TXT
 * value. The current WEDOS row is accepted only when every ownership field
 * and the stored digest match. This is intentionally stricter than a lookup
 * by name because the cleanup path must never touch a foreign TXT row.
 */
export async function cleanupDnsOperationByOwnership(
  db: Db,
  operationId: string,
  api: WedosDnsApi,
  resolver: AuthoritativeTxtResolver = waitForAuthoritativeTxt
): Promise<WedosDnsOperation> {
  const operation = await getWedosDnsOperation(db, operationId);
  if (operation.state === "CLEANUP_PROPAGATED") return operation;
  const response = await api.rowsList(operation.zone);
  const rows = parseWdnsRows(response.data);
  const candidates = rows.filter((row) =>
    row.name === operation.recordName &&
    row.rdtype === "TXT" &&
    row.authorComment === operation.authorComment &&
    sha256Digest(row.rdata) === operation.valueDigest &&
    (!operation.wedosRowId || row.id.toUpperCase() === operation.wedosRowId.toUpperCase())
  );
  if (candidates.length > 1) throw new Error("wedos_dns_owned_row_ambiguous");
  const owned = candidates[0];
  if (!owned) {
    if (operation.state === "CREATED") {
      return failWedosDnsOperation(db, operation.id, new Error("wedos_dns_owned_row_not_found_before_add"));
    }
    if (operation.state === "CLEANUP_REQUESTED" || operation.state === "DELETED") {
      const authoritativeValue = await findAuthoritativeTxtByDigest(operation.zone, operation.recordName, operation.valueDigest);
      if (authoritativeValue) return cleanupDnsOperation(db, operation.id, authoritativeValue, api, resolver);
      return markCleanupPropagatedWithoutValue(db, operation.id);
    }
    throw new Error("wedos_dns_owned_row_missing_for_recovery");
  }
  if (operation.state === "DELETED") throw new Error("wedos_dns_deleted_operation_row_still_present");
  if (operation.wedosRowId && owned.id.toUpperCase() !== operation.wedosRowId.toUpperCase()) {
    throw new Error("wedos_dns_cleanup_row_ownership_mismatch");
  }
  return cleanupDnsOperation(db, operation.id, owned.rdata, api, resolver);
}

async function markCleanupPropagatedWithoutValue(db: Db, operationId: string): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    const operation = await getOperation(client, operationId, true);
    if (operation.state === "CLEANUP_PROPAGATED") return operation;
    if (operation.state === "CLEANUP_REQUESTED") await updateState(client, operationId, ["CLEANUP_REQUESTED"], "DELETED");
    await updateState(client, operationId, ["DELETED"], "CLEANUP_PROPAGATED");
    return getOperation(client, operationId);
  });
}

export async function listActiveWedosDnsOperations(db: Db, purpose?: WedosDnsPurpose): Promise<WedosDnsOperation[]> {
  const clauses = ["state NOT IN ('CLEANUP_PROPAGATED','FAILED','BLOCKED')"];
  const params: string[] = [];
  if (purpose) {
    params.push(purpose);
    clauses.push(`purpose=$${params.length}`);
  }
  const result = await db.query(`${operationSelect} where ${clauses.join(" and ")} order by created_at asc`, params);
  return result.rows.map((row) => operationFromRow(row));
}

export async function failWedosDnsOperation(db: Db, operationId: string, error: unknown): Promise<WedosDnsOperation> {
  return withOperationLock(db, operationId, async (client) => {
    const operation = await getOperation(client, operationId, true);
    if (["CLEANUP_PROPAGATED", "FAILED", "BLOCKED"].includes(operation.state)) return operation;
    await recordSafeError(client, operationId, error);
    await updateState(client, operationId, ["CREATED", "ROW_ADDED", "COMMITTED", "PROPAGATED", "CLEANUP_REQUESTED", "DELETED"], "FAILED");
    return getOperation(client, operationId);
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
