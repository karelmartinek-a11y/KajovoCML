import { describe, expect, it } from "vitest";
import { isKcmlHostname, resourceFor } from "./catalog.js";

describe("host routing invariants", () => {
  it("accepts only canonical kcml hostnames under the configured base domain", () => {
    expect(isKcmlHostname("kcml0001.hcasc.cz", "hcasc.cz")).toBe(true);
    expect(isKcmlHostname("KCML10000.hcasc.cz", "hcasc.cz")).toBe(true);
    expect(isKcmlHostname("kcml1.hcasc.cz", "hcasc.cz")).toBe(false);
    expect(isKcmlHostname("admin.hcasc.cz", "hcasc.cz")).toBe(false);
    expect(isKcmlHostname("kcml0001.example.cz", "hcasc.cz")).toBe(false);
  });

  it("binds OAuth resource to exact MCP URI", () => {
    expect(resourceFor("kcml0001.hcasc.cz")).toBe("https://kcml0001.hcasc.cz/mcp");
  });
});
