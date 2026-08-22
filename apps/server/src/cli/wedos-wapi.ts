import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { platformWorkerSecretPrincipal, resolveSecret } from "../domain/secret-manager.js";
import { acmeRelativeTxtName, WedosWapiClient, parseWdnsDomainInfo, parseWdnsDomains } from "../tls/wedos-wapi.js";
import { cleanupDnsOperation, findOperationIdInAuthOutput, getWedosDnsOperation, recoverDnsOperation, runDnsOperation } from "../tls/wedos-dns-operation.js";

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
    return `wapi_error:${String(error.code)}:${command}`;
  }
  return (error instanceof Error ? error.message : "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 240);
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
      const operation = await runDnsOperation(db, { purpose: "PREFLIGHT_TEST", zone, recordName, value }, client);
      return cleanupDnsOperation(db, operation.id, value, client);
    });
    process.stdout.write(`wedos-wapi:roundtrip:operation=${result.id}:record=${recordName}:state=${result.state}\n`);
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
  throw new Error("usage: kcml-wedos-wapi <ping|preflight|acme-auth|acme-cleanup|wapi-test-roundtrip|recover>");
}

void main().catch((error: unknown) => {
  process.stderr.write(`wedos-wapi:FAIL:${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
