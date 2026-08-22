import { randomUUID } from "node:crypto";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { platformWorkerSecretPrincipal, resolveSecret } from "../domain/secret-manager.js";
import { WedosWapiClient, parseWdnsDomainInfo } from "../tls/wedos-wapi.js";

type SafeResult = Readonly<{ command: string; outcome: string; code: number }>;

async function withClient<T>(run: (client: WedosWapiClient) => Promise<T>): Promise<T> {
  const config = loadBootstrapConfig();
  const db = createDb(config);
  const correlationId = randomUUID();
  try {
    const principal = await platformWorkerSecretPrincipal(db);
    const [login, password] = await Promise.all([
      resolveSecret(db, config, principal, "WEDOS_WAPI_LOGIN", correlationId),
      resolveSecret(db, config, principal, "WEDOS_WAPI_PASSWORD", correlationId)
    ]);
    return await run(new WedosWapiClient({ login: login.value, password: password.value }));
  } finally {
    await db.end();
  }
}

function safe(response: { command: string; outcome: string; code: number }): SafeResult {
  return { command: response.command, outcome: response.outcome, code: response.code };
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
      return { ping: safe(ping), domains: safe(domains), domain: { ...safe(domainInfo), ...parseWdnsDomainInfo(domainInfo.data, "hcasc.cz") } };
    });
    process.stdout.write(`wedos-wapi:preflight:${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error("usage: kcml-wedos-wapi <ping|preflight>");
}

void main().catch((error: unknown) => {
  process.stderr.write(`wedos-wapi:FAIL:${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
