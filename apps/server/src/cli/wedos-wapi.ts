import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { platformWorkerSecretPrincipal, resolveSecret } from "../domain/secret-manager.js";
import { acmeRelativeTxtName, WedosWapiClient, parseWdnsDomainInfo, parseWdnsDomains, parseWdnsRows } from "../tls/wedos-wapi.js";
import {
  addTxtRow,
  cleanupDnsOperation,
  cleanupDnsOperationByOwnership,
  commitDnsOperation,
  createWedosDnsOperation,
  failWedosDnsOperation,
  findOperationIdInAuthOutput,
  getWedosDnsOperation,
  listActiveWedosDnsOperations,
  markPropagated,
  observeAuthoritativeDns,
  recoverDnsOperation,
  sha256Digest,
  runDnsOperation,
  safeAuthoritativeDnsDiagnostics,
  WedosDnsObservationError
} from "../tls/wedos-dns-operation.js";

type SafeResult = Readonly<{ command: string; outcome: string; code: number }>;

async function withClient<T>(run: (client: WedosWapiClient, db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const config = loadBootstrapConfig();
  const db = createDb(config);
  const correlationId = randomUUID();
  try {
    const principal = await platformWorkerSecretPrincipal(db);
    const [login, password] = await Promise.all([
      resolveSecret(db, config, principal, "WEDOS_WAPI_LOGIN", correlationId),
      resolveSecret(db, config, principal, "WEDOS_WAPI_PASSWORD", correlationId)
    ]);
    return await run(new WedosWapiClient({ login: login.value, password: password.value }), db);
  } finally {
    await db.end();
  }
}

function safe(response: { command: string; outcome: string; code: number }): SafeResult {
  return { command: response.command, outcome: response.outcome, code: response.code };
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    const issue = error.issues[0] as { path?: unknown[]; message?: unknown } | undefined;
    const path = Array.isArray(issue?.path) ? issue.path.map((part) => String(part)).join(".") : "unknown";
    const message = typeof issue?.message === "string" ? issue.message : "validation_failed";
    return `validation_error:${path}:${message}`.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 240);
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "number") {
    const command = "command" in error && typeof error.command === "string" ? error.command : "unknown";
    const result = "result" in error && typeof error.result === "string" ? error.result : "";
    const safeResult = result
      .replace(/(?:password|passwd|auth|secret|token|api[_ -]?key)\s*[:=]\s*[^,;\s]+/gi, "[redacted]")
      .replace(/[^a-zA-Z0-9_.: -]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 160);
    return `wapi_error:${String(error.code)}:${command}:${safeResult || "no_result"}`;
  }
  return (error instanceof Error ? error.message : "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 240);
}

async function writeRecoveryDiagnostics(client: WedosWapiClient, operation: Awaited<ReturnType<typeof getWedosDnsOperation>>): Promise<void> {
  const rows = parseWdnsRows((await client.rowsList(operation.zone)).data);
  const owned = rows.find((row) =>
    row.name === operation.recordName &&
    row.rdtype === "TXT" &&
    row.authorComment === operation.authorComment &&
    sha256Digest(row.rdata) === operation.valueDigest &&
    (!operation.wedosRowId || row.id.toUpperCase() === operation.wedosRowId)
  );
  process.stderr.write(`wedos-dns:operation=${operation.id}\n`);
  process.stderr.write(`wedos-dns:operation-state=${operation.state}\n`);
  process.stderr.write(`wedos-dns:wapi-row-present=${owned ? "yes" : "no"}\n`);
  process.stderr.write(`wedos-dns:wapi-row-id=${operation.wedosRowId ?? "unknown"}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "ping") {
    const result = await withClient(async (client) => safe(await client.ping()));
    process.stdout.write(`wedos-wapi:ping:${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "preflight") {
    const result = await withClient(async (client) => {
      const [ping, domains, domainInfo] = await Promise.all([client.ping(), client.domainsList(), client.domainInfo("hcasc.cz")]);
      const parsedDomains = parseWdnsDomains(domains.data);
      return { ping: safe(ping), domains: { ...safe(domains), count: parsedDomains.length }, domain: { ...safe(domainInfo), ...parseWdnsDomainInfo(domainInfo.data, "hcasc.cz") } };
    });
    process.stdout.write(`wedos-wapi:preflight:${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "acme-auth") {
    const zone = process.env.KCML_ACME_ZONE ?? "hcasc.cz";
    const domain = process.env.CERTBOT_DOMAIN;
    const validation = process.env.CERTBOT_VALIDATION;
    if (!domain || !validation) throw new Error("wedos_acme_environment_missing");
    const result = await withClient(async (client, db) => runDnsOperation(db, {
      purpose: "ACME", zone, recordName: acmeRelativeTxtName(domain, zone), value: validation
    }, client));
    process.stdout.write(`kcml-operation-id=${result.id}\n`);
    return;
  }
  if (command === "acme-cleanup") {
    const zone = process.env.KCML_ACME_ZONE ?? "hcasc.cz";
    const domain = process.env.CERTBOT_DOMAIN;
    const validation = process.env.CERTBOT_VALIDATION;
    if (!domain || !validation) throw new Error("wedos_acme_environment_missing");
    const operationId = findOperationIdInAuthOutput(process.env.CERTBOT_AUTH_OUTPUT);
    const result = await withClient(async (client, db) => {
      const operation = await getWedosDnsOperation(db, operationId);
      if (operation.purpose !== "ACME" || operation.zone !== zone || operation.recordName !== acmeRelativeTxtName(domain, zone)) throw new Error("wedos_acme_operation_scope_mismatch");
      return cleanupDnsOperation(db, operationId, validation, client);
    });
    process.stdout.write(`wedos-acme-cleanup:operation=${result.id}:state=${result.state}\n`);
    return;
  }
  if (command === "wapi-test-roundtrip") {
    const zone = process.env.KCML_ACME_ZONE ?? "hcasc.cz";
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const recordName = `_kcml-wapi-test-${suffix}`;
    const value = `kcml-wapi-${randomUUID()}`;
    const result = await withClient(async (client, db) => {
      const created = await createWedosDnsOperation(db, { purpose: "PREFLIGHT_TEST", zone, recordName, value });
      try {
        const baseline = await observeAuthoritativeDns(zone, recordName, value);
        await addTxtRow(db, created.id, value, client);
        await commitDnsOperation(db, created.id, value, client);
        const owned = parseWdnsRows((await client.rowsList(zone)).data).find((row) =>
          row.name === recordName && row.rdtype === "TXT" && row.rdata === value && row.authorComment === created.authorComment
        );
        process.stderr.write(`wedos-dns:operation=${created.id}\n`);
        process.stderr.write(`wedos-dns:wapi-row-present=${owned ? "yes" : "no"}\n`);
        if (owned) process.stderr.write(`wedos-dns:wapi-row-id=${owned.id}\n`);
        if (!owned) throw new Error("wedos_dns_wapi_owned_row_missing_after_commit");
        const propagated = await markPropagated(db, created.id, value, client, undefined, baseline);
        return cleanupDnsOperation(db, propagated.id, value, client);
      } catch (error) {
        const current = await getWedosDnsOperation(db, created.id);
        if (current.state === "CREATED") {
          await failWedosDnsOperation(db, created.id, error);
        } else {
          await cleanupDnsOperation(db, created.id, value, client);
        }
        throw error;
      }
    });
    process.stdout.write(`wedos-wapi:roundtrip:operation=${result.id}:record=${recordName}:state=${result.state}\n`);
    return;
  }
  if (command === "recover-preflight" || command === "recover-acme") {
    const purpose = command === "recover-preflight" ? "PREFLIGHT_TEST" : "ACME";
    const result = await withClient(async (client, db) => {
      const operations = await listActiveWedosDnsOperations(db, purpose);
      const recoverOne = async (operation: Awaited<ReturnType<typeof listActiveWedosDnsOperations>>[number]) => {
        try {
          const cleanup = await cleanupDnsOperationByOwnership(db, operation.id, client);
          return { id: cleanup.id, state: cleanup.state };
        } catch (error) {
          const current = await getWedosDnsOperation(db, operation.id);
          await writeRecoveryDiagnostics(client, current);
          // Keep the original structured observation intact. The top-level
          // handler prints only its safe, per-authority diagnostics.
          if (error instanceof WedosDnsObservationError) throw error;
          throw new Error(`wedos_dns_${purpose.toLowerCase()}_recovery_failed:${operation.id}:${operation.recordName}:${safeErrorMessage(error)}`);
        }
      };
      // ACME may leave independent TXT challenges after a cancelled certbot
      // invocation. Their exact ownership locks are per operation, so recover
      // them concurrently instead of allowing a serial cleanup to exhaust the
      // bootstrap deployment budget. PREFLIGHT recovery stays serial for a
      // single diagnostic operation.
      if (purpose === "ACME") {
        const settled = await Promise.allSettled(operations.map(recoverOne));
        const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
        if (failed) throw failed.reason;
        return settled.map((entry) => (entry as PromiseFulfilledResult<Awaited<ReturnType<typeof recoverOne>>>).value);
      }
      const recovered = [];
      for (const operation of operations) recovered.push(await recoverOne(operation));
      return recovered;
    });
    process.stdout.write(`wedos-dns-recovery:${purpose.toLowerCase()}:${JSON.stringify({ count: result.length, operations: result })}\n`);
    return;
  }
  if (command === "recover") {
    const operationId = process.env.KCML_WEDOS_OPERATION_ID;
    const value = process.env.CERTBOT_VALIDATION;
    if (!operationId || !value) throw new Error("wedos_recovery_environment_missing");
    const result = await withClient(async (client, db) => recoverDnsOperation(db, operationId, value, client));
    process.stdout.write(`wedos-dns-recovery:operation=${result.id}:state=${result.state}\n`);
    return;
  }
  throw new Error("usage: kcml-wedos-wapi <ping|preflight|acme-auth|acme-cleanup|wapi-test-roundtrip|recover-preflight|recover-acme|recover>");
}

void main().catch((error: unknown) => {
  if (error instanceof WedosDnsObservationError) {
    for (const line of safeAuthoritativeDnsDiagnostics(error.snapshot, error.baseline, error.expectedPresent)) process.stderr.write(`${line}\n`);
  }
  process.stderr.write(`wedos-wapi:FAIL:${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
