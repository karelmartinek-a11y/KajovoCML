import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const WEDOS_WAPI_URL = "https://api.wedos.com/wapi/json";
export type WapiCredentials = Readonly<{ login: string; password: string }>;
export type WapiOutcome = "OK" | "PENDING" | "EMPTY" | "ACKNOWLEDGED";
export type WapiResponse<T = Record<string, unknown>> = Readonly<{
  code: number; result: string; clTRID: string; svTRID: string | null; command: string; outcome: WapiOutcome; data: T | null;
}>;

type FetchLike = typeof fetch;
type RawResponse = { code?: unknown; result?: unknown; clTRID?: unknown; svTRID?: unknown; command?: unknown; data?: unknown };

export class WedosWapiError extends Error {
  constructor(readonly code: number, message: string, readonly retryAfterMs: number | null = null) { super(message); }
}

export class WedosWapiCircuitOpenError extends Error {
  constructor(readonly code: number, readonly retryAfterMs: number | null) { super("wedos_wapi_circuit_open"); }
}

// WEDOS WAPI authenticates requests with this protocol-defined SHA-1 value.
// It is never stored as a password verifier. codeql[js/insufficient-password-hash]
function sha1(value: string): string { return createHash("sha1").update(value, "utf8").digest("hex"); }

/** WEDOS defines the hour in Europe/Prague, rather than UTC. */
export function pragueHour(now = new Date()): string {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).find((part) => part.type === "hour")?.value;
  if (!hour || !/^\d{2}$/.test(hour)) throw new Error("wedos_prague_hour_unavailable");
  return hour;
}

export function wedosAuth(credentials: WapiCredentials, now = new Date()): string {
  return sha1(`${credentials.login}${sha1(credentials.password)}${pragueHour(now)}`);
}

export function acmeRelativeTxtName(certbotDomain: string, zone = "hcasc.cz"): string {
  const normalized = certbotDomain.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  if (normalized !== zone && !normalized.endsWith(`.${zone}`)) throw new Error("wedos_acme_domain_outside_zone");
  const prefix = normalized === zone ? "" : normalized.slice(0, -(zone.length + 1));
  return prefix ? `_acme-challenge.${prefix}` : "_acme-challenge";
}

function responseError(code: number, result: string): WedosWapiError {
  // These are orchestration signals, not undocumented WEDOS Retry-After values.
  // A durable caller decides when a later retry is permitted.
  if (code === 2006) return new WedosWapiError(code, "wedos_wapi_rate_limited");
  if (code === 2050) return new WedosWapiError(code, "wedos_wapi_authentication_failed");
  if (code === 2051) return new WedosWapiError(code, "wedos_wapi_source_ip_not_allowed");
  if (code === 2052) return new WedosWapiError(code, "wedos_wapi_source_ip_temporarily_blocked");
  return new WedosWapiError(code, `wedos_wapi_error_${code}:${result.slice(0, 160)}`);
}

const ASYNC_COMMANDS = new Set<string>();
const COMMAND_OUTCOMES: Record<string, Readonly<Record<number, WapiOutcome>>> = {
  "poll-req": { 1000: "OK", 1003: "EMPTY" },
  "poll-ack": { 1002: "ACKNOWLEDGED" }
};

function outcomeFor(command: string, code: number): WapiOutcome | null {
  const specific = COMMAND_OUTCOMES[command]?.[code];
  if (specific) return specific;
  if (code === 1000) return "OK";
  if (code === 1001 && ASYNC_COMMANDS.has(command)) return "PENDING";
  return null;
}

const wapiDomainSchema = z.object({
  name: z.string().trim().min(1), type: z.string().trim().min(1), status: z.string().trim().min(1),
  error: z.unknown().optional(), error_code: z.unknown().optional()
}).passthrough();
const wapiDomainsDataSchema = z.object({ domain: z.array(wapiDomainSchema).min(1) }).passthrough();
const wapiRowSchema = z.object({
  ID: z.union([z.string().trim().min(1), z.number().int().nonnegative()]), name: z.string().trim().min(1),
  ttl: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]), rdtype: z.string().trim().min(1),
  rdata: z.string(), changed_date: z.string().trim().min(1), author_comment: z.string()
}).passthrough();
const wapiRowsDataSchema = z.object({ row: z.array(wapiRowSchema) }).passthrough();

export type WdnsDomain = Readonly<{ name: string; type: string; status: string }>;
export type WdnsRow = Readonly<{ id: string; name: string; ttl: number; rdtype: string; rdata: string; changedDate: string; authorComment: string }>;

function noEmbeddedDomainError(value: z.infer<typeof wapiDomainSchema>): void {
  if (value.error !== undefined || value.error_code !== undefined) throw new Error("wedos_wapi_domain_embedded_error");
}

export function parseWdnsDomains(data: unknown): WdnsDomain[] {
  return wapiDomainsDataSchema.parse(data).domain.map((domain) => {
    noEmbeddedDomainError(domain);
    return { name: domain.name.toLowerCase(), type: domain.type.toLowerCase(), status: domain.status.toLowerCase() };
  });
}

export function parseWdnsDomainInfo(data: unknown, expectedName: string): WdnsDomain {
  const expected = expectedName.trim().toLowerCase();
  const domain = parseWdnsDomains(data).find((item) => item.name === expected);
  if (!domain) throw new Error("wedos_wapi_domain_not_found");
  if (domain.status !== "active" || domain.type !== "primary") throw new Error("wedos_wapi_domain_not_active_primary");
  return domain;
}

export function parseWdnsRows(data: unknown): WdnsRow[] {
  return wapiRowsDataSchema.parse(data).row.map((row) => ({
    id: String(row.ID), name: row.name, ttl: Number(row.ttl), rdtype: row.rdtype.toUpperCase(), rdata: row.rdata,
    changedDate: row.changed_date, authorComment: row.author_comment
  }));
}

function validateResponse(command: string, raw: RawResponse | undefined, clTRID: string): { code: number; result: string; svTRID: string | null; data: Record<string, unknown> | null; outcome: WapiOutcome } {
  const code = Number(raw?.code);
  if (!Number.isInteger(code) || typeof raw?.clTRID !== "string" || raw.clTRID !== clTRID) throw new Error("wedos_wapi_correlation_invalid");
  if (typeof raw.command !== "string" || raw.command !== command) throw new Error("wedos_wapi_command_mismatch");
  if (raw.svTRID !== undefined && (typeof raw.svTRID !== "string" || !raw.svTRID.trim())) throw new Error("wedos_wapi_svtrid_invalid");
  if (raw.data !== undefined && raw.data !== null && (typeof raw.data !== "object" || Array.isArray(raw.data))) throw new Error("wedos_wapi_data_schema_invalid");
  const result = typeof raw.result === "string" ? raw.result : "";
  const outcome = outcomeFor(command, code);
  if (!outcome) throw responseError(code, result);
  return { code, result, svTRID: typeof raw.svTRID === "string" ? raw.svTRID : null, data: (raw.data ?? null) as Record<string, unknown> | null, outcome };
}

export class WedosWapiClient {
  private circuit: { code: number; openedAt: number } | null = null;
  constructor(private readonly credentials: WapiCredentials, private readonly fetchImpl: FetchLike = fetch, private readonly now: () => Date = () => new Date()) {}

  async request<T = Record<string, unknown>>(command: string, data?: Record<string, unknown>, test = false): Promise<WapiResponse<T>> {
    if (this.circuit) throw new WedosWapiCircuitOpenError(this.circuit.code, null);
    const clTRID = `kcml-${command}-${randomUUID()}`;
    const request = { user: this.credentials.login, auth: wedosAuth(this.credentials, this.now()), command, ...(data ? { data } : {}), clTRID, ...(test ? { test: "1" } : {}) };
    const response = await this.fetchImpl(WEDOS_WAPI_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: JSON.stringify({ request }) }), signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new WedosWapiError(response.status, `wedos_wapi_transport_${response.status}`, response.status === 429 ? 60_000 : null);
    const body = await response.json() as { response?: RawResponse };
    const raw = body.response;
    try {
      const parsed = validateResponse(command, raw, clTRID);
      return { ...parsed, clTRID, command, data: parsed.data as T | null };
    } catch (error) {
      if (error instanceof WedosWapiError && (error.code === 2006 || error.code === 2052)) this.circuit = { code: error.code, openedAt: this.now().getTime() };
      throw error;
    }
  }

  ping(): Promise<WapiResponse> { return this.request("ping"); }
  domainsList(): Promise<WapiResponse> { return this.request("dns-domains-list"); }
  domainInfo(domain: string): Promise<WapiResponse> { return this.request("dns-domain-info", { name: domain }); }
  rowsList(domain: string): Promise<WapiResponse> { return this.request("dns-rows-list", { domain }); }
  rowDetail(domain: string, rowId: string): Promise<WapiResponse> { return this.request("dns-row-detail", { name: domain, row_id: rowId }); }
  rowAdd(domain: string, name: string, rdata: string, authorComment: string, ttl: number): Promise<WapiResponse> {
    if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("wedos_wapi_ttl_invalid");
    return this.request("dns-row-add", { domain, name, ttl, type: "TXT", rdata, author_comment: authorComment });
  }
  rowDelete(domain: string, rowId: string): Promise<WapiResponse> { return this.request("dns-row-delete", { domain, row_id: rowId }); }
  domainCommit(domain: string): Promise<WapiResponse> { return this.request("dns-domain-commit", { name: domain }); }
  pollReq(): Promise<WapiResponse> { return this.request("poll-req"); }
  pollAck(id: string): Promise<WapiResponse> { return this.request("poll-ack", { id }); }
}
