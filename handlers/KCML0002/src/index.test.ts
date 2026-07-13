import { describe, expect, it, vi } from "vitest";
import { invoke } from "./index.js";

const catalog = {
  schema: "ha_device_catalog.v3",
  language: "cs-CZ",
  devices: [{ device_key: "dev_0123456789", name: "Světlo" }]
};

function context(response = catalog, ok = true) {
  return {
    correlationId: "00000000-0000-4000-8000-000000000000",
    logger: { info: vi.fn(), error: vi.fn() },
    egress: {
      fetch: vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => response }))
    }
  };
}

describe("Home Assistant device catalog handler", () => {
  it("returns the complete structured upstream response without duplication", async () => {
    const runtime = context();
    await expect(invoke({}, runtime)).resolves.toEqual(catalog);
    expect(runtime.egress.fetch).toHaveBeenCalledWith(
      "https://ha-inventory.hcasc.cz/v1/catalog",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects input fields because the list function has no arguments", async () => {
    await expect(invoke({ extra: true }, context())).rejects.toThrow("invalid_input");
  });

  it("fails closed for an upstream or contract error", async () => {
    await expect(invoke({}, context(catalog, false))).rejects.toThrow("home_assistant_catalog_upstream_failed");
    await expect(invoke({}, context({ ...catalog, schema: "other", devices: [] }))).rejects.toThrow("home_assistant_catalog_contract_mismatch");
  });
});
