import { describe, expect, it, vi } from "vitest";
import { WedosWapiClient, WedosWapiCircuitOpenError, acmeRelativeTxtName, parseWdnsDomainInfo, parseWdnsDomains, parseWdnsRows, pragueHour, wedosAuth } from "./wedos-wapi.js";

function responseFor(request: Record<string, unknown>, code = 1000, data?: Record<string, unknown>) {
  return new Response(JSON.stringify({ response: { code, result: "OK", clTRID: request.clTRID, svTRID: "server-1", command: request.command, ...(data ? { data } : {}) } }), { status: 200 });
}

function fetchRecording(code = 1000) {
  let request: Record<string, unknown> | null = null;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    request = JSON.parse(String((init.body as URLSearchParams).get("request"))).request;
    return responseFor(request!, code);
  });
  return { fetchMock, request: () => request };
}

describe("WEDOS WAPI client", () => {
  it("uses Europe/Prague hour and the documented nested SHA-1 authorization", () => {
    const credentials = { login: "owner@example.test", password: "not-a-real-secret" };
    expect(pragueHour(new Date("2026-01-01T12:00:00.000Z"))).toBe("13");
    expect(wedosAuth(credentials, new Date("2026-01-01T12:00:00.000Z"))).toBe("ee0051fb256eaf59d6c2193edb4011363e4c3481");
    expect(pragueHour(new Date("2026-01-01T23:00:00.000Z"))).toBe("00");
    expect(pragueHour(new Date("2026-07-01T22:15:00.000Z"))).toBe("00");
  });

  it("submits a correlated form-encoded JSON request without exposing credentials", async () => {
    let requestPayload = "";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (!(init.body instanceof URLSearchParams)) throw new Error("expected_form_encoded_body");
      requestPayload = init.body.get("request") ?? "";
      const raw = JSON.parse(requestPayload || "{}").request;
      return new Response(JSON.stringify({ response: { code: 1000, result: "OK", clTRID: raw.clTRID, svTRID: "server-1", command: raw.command } }), { status: 200 });
    });
    const client = new WedosWapiClient({ login: "owner@example.test", password: "not-a-real-secret" }, fetchMock as unknown as typeof fetch, () => new Date("2026-01-01T12:00:00Z"));
    await expect(client.ping()).resolves.toMatchObject({ code: 1000, command: "ping", svTRID: "server-1" });
    expect(requestPayload).not.toContain("not-a-real-secret");
  });

  it("maps wildcard authorization domains to WEDOS relative TXT names", () => {
    expect(acmeRelativeTxtName("hcasc.cz")).toBe("_acme-challenge");
    expect(acmeRelativeTxtName("*.hcasc.cz")).toBe("_acme-challenge");
    expect(acmeRelativeTxtName("*.kajovocml.hcasc.cz")).toBe("_acme-challenge.kajovocml");
  });

  it.each([
    ["ping", (client: WedosWapiClient) => client.ping(), undefined],
    ["dns-domains-list", (client: WedosWapiClient) => client.domainsList(), undefined],
    ["dns-domain-info", (client: WedosWapiClient) => client.domainInfo("hcasc.cz"), { name: "hcasc.cz" }],
    ["dns-rows-list", (client: WedosWapiClient) => client.rowsList("hcasc.cz"), { domain: "hcasc.cz" }],
    ["dns-row-detail", (client: WedosWapiClient) => client.rowDetail("hcasc.cz", "42"), { name: "hcasc.cz", row_id: "42" }],
    ["dns-row-add", (client: WedosWapiClient) => client.rowAdd("hcasc.cz", "_test", "value", "kcml:test", 300), { domain: "hcasc.cz", name: "_test", ttl: 300, type: "TXT", rdata: "value", author_comment: "kcml:test" }],
    ["dns-row-delete", (client: WedosWapiClient) => client.rowDelete("hcasc.cz", "42"), { domain: "hcasc.cz", row_id: "42" }],
    ["dns-domain-commit", (client: WedosWapiClient) => client.domainCommit("hcasc.cz"), { name: "hcasc.cz" }],
    ["poll-req", (client: WedosWapiClient) => client.pollReq(), undefined],
    ["poll-ack", (client: WedosWapiClient) => client.pollAck("notice-1"), { id: "notice-1" }]
  ])("uses the exact %s command payload", async (_command, invoke, expectedData) => {
    const recorded = fetchRecording();
    const client = new WedosWapiClient({ login: "owner@example.test", password: "not-a-real-secret" }, recorded.fetchMock as unknown as typeof fetch);
    await invoke(client);
    expect(recorded.request()).toMatchObject({ command: _command, ...(expectedData ? { data: expectedData } : {}) });
  });

  it("treats only command-specific POLL response codes as non-error outcomes", async () => {
    for (const [code, invoke, outcome] of ([
      [1003, (client: WedosWapiClient) => client.pollReq(), "EMPTY"],
      [1002, (client: WedosWapiClient) => client.pollAck("notice-1"), "ACKNOWLEDGED"]
    ] as const)) {
      const recorded = fetchRecording(code);
      const client = new WedosWapiClient({ login: "owner@example.test", password: "not-a-real-secret" }, recorded.fetchMock as unknown as typeof fetch);
      await expect(invoke(client)).resolves.toMatchObject({ code, outcome });
    }
  });

  it("rejects undocumented pending commit responses rather than treating them as success", async () => {
    const recorded = fetchRecording(1001);
    const client = new WedosWapiClient({ login: "owner@example.test", password: "not-a-real-secret" }, recorded.fetchMock as unknown as typeof fetch);
    await expect(client.domainCommit("hcasc.cz")).rejects.toMatchObject({ code: 1001 });
  });

  it("parses documented WDNS domain and uppercase row schemas strictly", () => {
    const data = { domain: [{ name: "hcasc.cz", status: "ACTIVE", type: "PRIMARY" }] };
    expect(parseWdnsDomains(data)).toEqual([{ name: "hcasc.cz", status: "active", type: "primary" }]);
    expect(parseWdnsDomainInfo(data, "hcasc.cz")).toEqual({ name: "hcasc.cz", status: "active", type: "primary" });
    expect(parseWdnsRows({ row: [{ ID: "ab12", name: "_acme-challenge", ttl: 300, rdtype: "TXT", rdata: "value", changed_date: "2026-08-22 10:00:00", author_comment: "kcml-acme:00000000-0000-0000-0000-000000000000" }] })).toEqual([
      { id: "AB12", name: "_acme-challenge", ttl: 300, rdtype: "TXT", rdata: "value", changedDate: "2026-08-22 10:00:00", authorComment: "kcml-acme:00000000-0000-0000-0000-000000000000" }
    ]);
  });

  it.each([
    [{ domain: [{ name: "other.cz", status: "ACTIVE", type: "PRIMARY" }] }],
    [{ domain: [{ name: "hcasc.cz", status: "DISABLED", type: "PRIMARY" }] }],
    [{ domain: [{ name: "hcasc.cz", status: "ACTIVE", type: "SECONDARY" }] }],
    [{ domain: [{ name: "hcasc.cz", status: "ACTIVE", type: "PRIMARY", error: { code: 2000 } }] }],
    [{ domain: [{ name: "hcasc.cz", status: "ACTIVE" }] }]
  ])("rejects malformed or non-primary WDNS domain-info", (data) => {
    expect(() => parseWdnsDomainInfo(data, "hcasc.cz")).toThrow();
  });

  it("fails closed on a command mismatch and opens its circuit after quota or IP block", async () => {
    const mismatch = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String((init.body as URLSearchParams).get("request"))).request;
      return new Response(JSON.stringify({ response: { code: 1000, result: "OK", clTRID: request.clTRID, svTRID: "server-1", command: "other" } }));
    });
    await expect(new WedosWapiClient({ login: "owner@example.test", password: "not-a-real-secret" }, mismatch as unknown as typeof fetch).ping()).rejects.toThrow("wedos_wapi_command_mismatch");
    const blocked = fetchRecording(2052);
    const client = new WedosWapiClient({ login: "owner@example.test", password: "not-a-real-secret" }, blocked.fetchMock as unknown as typeof fetch);
    await expect(client.ping()).rejects.toMatchObject({ code: 2052 });
    await expect(client.ping()).rejects.toBeInstanceOf(WedosWapiCircuitOpenError);
    expect(blocked.fetchMock).toHaveBeenCalledTimes(1);
  });
});
