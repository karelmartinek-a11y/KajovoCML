import { createHash, randomUUID } from "node:crypto";

export const WEDOS_WAPI_URL = "https://api.wedos.com/wapi/json";
export type WapiCredentials = Readonly<{ login: string; password: string }>;
export type WapiResponse<T = Record<string, unknown>> = Readonly<{
  code: number; result: string; clTRID: string; svTRID: string | null; command: string; data: T | null;
}>;

type FetchLike = typeof fetch;
type RawResponse = { code?: unknown; result?: unknown; clTRID?: unknown; svTRID?: unknown; command?: unknown; data?: unknown };

export class WedosWapiError extends Error {
  constructor(readonly code: number, message: string, readonly retryAfterMs: number | null = null) { super(message); }
}

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
  if (code === 2006) return new WedosWapiError(code, "wedos_wapi_rate_limited", 60_000);
  if (code === 2050) return new WedosWapiError(code, "wedos_wapi_authentication_failed");
  if (code === 2051) return new WedosWapiError(code, "wedos_wapi_source_ip_not_allowed");
  if (code === 2052) return new WedosWapiError(code, "wedos_wapi_source_ip_temporarily_blocked", 15 * 60_000);
  return new WedosWapiError(code, `wedos_wapi_error_${code}:${result.slice(0, 160)}`);
}

export class WedosWapiClient {
  constructor(private readonly credentials: WapiCredentials, private readonly fetchImpl: FetchLike = fetch, private readonly now: () => Date = () => new Date()) {}

  async request<T = Record<string, unknown>>(command: string, data?: Record<string, unknown>, test = false): Promise<WapiResponse<T>> {
    const clTRID = `kcml-${command}-${randomUUID()}`;
    const request = { user: this.credentials.login, auth: wedosAuth(this.credentials, this.now()), command, ...(data ? { data } : {}), clTRID, ...(test ? { test: "1" } : {}) };
    const response = await this.fetchImpl(WEDOS_WAPI_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: JSON.stringify({ request }) }), signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new WedosWapiError(response.status, `wedos_wapi_transport_${response.status}`, response.status === 429 ? 60_000 : null);
    const body = await response.json() as { response?: RawResponse };
    const raw = body.response;
    const code = Number(raw?.code);
    if (!Number.isInteger(code) || typeof raw?.clTRID !== "string" || raw.clTRID !== clTRID) throw new Error("wedos_wapi_correlation_invalid");
    const result = typeof raw.result === "string" ? raw.result : "";
    const parsed: WapiResponse<T> = { code, result, clTRID, svTRID: typeof raw.svTRID === "string" ? raw.svTRID : null, command: typeof raw.command === "string" ? raw.command : command, data: (raw.data ?? null) as T | null };
    if (code !== 1000 && code !== 1001) throw responseError(code, result);
    return parsed;
  }

  ping(): Promise<WapiResponse> { return this.request("ping"); }
  domainsList(): Promise<WapiResponse> { return this.request("dns-domains-list"); }
  domainInfo(domain: string): Promise<WapiResponse> { return this.request("dns-domain-info", { name: domain }); }
  rowsList(domain: string): Promise<WapiResponse> { return this.request("dns-rows-list", { domain }); }
  rowDetail(domain: string, rowId: string): Promise<WapiResponse> { return this.request("dns-row-detail", { domain, row_id: rowId }); }
  rowAdd(domain: string, name: string, rdata: string, authorComment: string, ttl = 60): Promise<WapiResponse> {
    return this.request("dns-row-add", { domain, name, ttl, type: "TXT", rdata, author_comment: authorComment });
  }
  rowDelete(domain: string, rowId: string): Promise<WapiResponse> { return this.request("dns-row-delete", { domain, row_id: rowId }); }
  domainCommit(domain: string): Promise<WapiResponse> { return this.request("dns-domain-commit", { name: domain }); }
  pollReq(): Promise<WapiResponse> { return this.request("poll-req"); }
  pollAck(id: string): Promise<WapiResponse> { return this.request("poll-ack", { id }); }
}
