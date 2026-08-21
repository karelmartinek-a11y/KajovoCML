import { describe, expect, it, vi } from "vitest";
import { WedosWapiClient, acmeRelativeTxtName, pragueHour, wedosAuth } from "./wedos-wapi.js";

describe("WEDOS WAPI client", () => {
  it("uses Europe/Prague hour and the documented nested SHA-1 authorization", () => {
    const now = new Date("2026-07-01T22:15:00.000Z");
    expect(pragueHour(now)).toBe("00");
    expect(wedosAuth({ login: "owner@example.test", password: "not-a-real-secret" }, now)).toMatch(/^[a-f0-9]{40}$/);
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
});
