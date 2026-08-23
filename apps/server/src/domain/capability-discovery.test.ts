import { describe, expect, it } from "vitest";
import { lookupCmlCapabilities, readCmlCapabilityContract, type Queryable } from "./capability-discovery.js";

const componentId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";

function dbFor(row: Record<string, unknown>): Queryable {
  return { query: async (sql: string) => {
    if (sql.includes("component_tool_contract where")) return { rows: [{ id: contractId, name: "lookup", title: "Lookup", description: "Reads a catalogue", input_schema: { type: "object" }, output_schema: { type: "object" }, scope_name: "component.read" }] };
    return { rows: [{ ...row, id: componentId, revision_id: revisionId, revision: "r1", manifest_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", capabilities: ["catalogue.read"], tools: [{ id: contractId, name: "lookup", title: "Lookup", description: "Reads a catalogue", inputSchema: { type: "object" }, outputSchema: { type: "object" }, requiredScope: "component.read" }] }] };
  } };
}

describe("canonical CML capability discovery", () => {
  it.each([
    [{ enabled: true, lifecycle_state: "ACTIVE", activation_state: "ACTIVE", operational_state: "HEALTHY", principal_status: "ACTIVE", ready: true, validation_state: "APPROVED" }, true],
    [{ enabled: false, lifecycle_state: "ACTIVE", activation_state: "ACTIVE", operational_state: "HEALTHY", principal_status: "ACTIVE", ready: true, validation_state: "APPROVED" }, false],
    [{ enabled: true, lifecycle_state: "SUSPENDED", activation_state: "ACTIVE", operational_state: "HEALTHY", principal_status: "ACTIVE", ready: true, validation_state: "APPROVED" }, false],
    [{ enabled: true, lifecycle_state: "ACTIVE", activation_state: "BLOCKED", operational_state: "HEALTHY", principal_status: "ACTIVE", ready: true, validation_state: "APPROVED" }, false],
    [{ enabled: true, lifecycle_state: "ACTIVE", activation_state: "ACTIVE", operational_state: "DEGRADED", principal_status: "ACTIVE", ready: true, validation_state: "APPROVED" }, false],
    [{ enabled: true, lifecycle_state: "ACTIVE", activation_state: "ACTIVE", operational_state: "HEALTHY", principal_status: "SUSPENDED", ready: true, validation_state: "APPROVED" }, false],
    [{ enabled: true, lifecycle_state: "ACTIVE", activation_state: "ACTIVE", operational_state: "HEALTHY", principal_status: "ACTIVE", ready: false, validation_state: "APPROVED" }, false]
  ])("derives runtime eligibility from canonical state: %o", async (row, eligible) => {
    const result = await lookupCmlCapabilities(dbFor(row), { requirement: "catalogue" });
    expect(result[0]?.runtimeEligibility === "ELIGIBLE").toBe(eligible);
    expect(result[0]?.contractMatch).toBe("CANDIDATE");
  });

  it("reads the exact active contract without returning credentials", async () => {
    const result = await readCmlCapabilityContract(dbFor({ enabled: true, lifecycle_state: "ACTIVE", activation_state: "ACTIVE", operational_state: "HEALTHY", principal_status: "ACTIVE", ready: true, validation_state: "APPROVED" }), componentId);
    expect(result?.revisionId).toBe(revisionId);
    expect(result?.tools[0]).toMatchObject({ contractId, name: "lookup", requiredScope: "component.read" });
    expect(JSON.stringify(result)).not.toMatch(/secret|token|password|ciphertext/i);
  });
});
