import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonitoringProfile, Server } from "./types.js";
import { persistMonitoringProfile, runRegisteredServerTest } from "./server-api.js";

afterEach(() => vi.unstubAllGlobals());

describe("server and monitoring API client", () => {
  it("previews a monitoring profile before committing the same versioned payload", async () => {
    vi.stubGlobal("document", { cookie: "__Host-kcml_csrf=csrf-value" });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetch);
    const server = { id: "server-1" } as Server;
    const profile = {
      enabled: true,
      version: 7,
      profile: {
        sloTargets: {}, probeIntervals: {}, alertRules: [], runbookRef: "runbook",
        primaryAlertChannel: "primary", backupAlertChannel: "backup", staleAfterSeconds: 60, retentionDays: 30
      }
    } satisfies MonitoringProfile;

    await persistMonitoringProfile(server, profile);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/mcp-servers/server-1/monitoring-profile/preview",
      "/api/mcp-servers/server-1/monitoring-profile"
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: fetch.mock.calls[1]?.[1]?.body });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("returns the registered server-test detail from the real endpoint contract", async () => {
    vi.stubGlobal("document", { cookie: "__Host-kcml_csrf=csrf-value" });
    const result = {
      ok: true,
      status: "PASSED",
      correlationId: "00000000-0000-4000-8000-000000000081",
      latencyMs: 12,
      activeRevisionId: "revision-1",
      manifestDigest: `sha256:${"a".repeat(64)}`,
      checkpoints: [
        {
          key: "contract",
          label: "Připravuji testovací kontrakt",
          description: "Načítám aktivní revizi a bezpečnostní režim testu.",
          status: "PASSED"
        }
      ],
      output: { safe: true }
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));
    await expect(runRegisteredServerTest({ id: "server-2" } as Server)).resolves.toEqual(result);
  });
});
