import { describe, expect, it } from "vitest";
import { validateCapabilityProposal, type CapabilityTurnEvidence, type GenerationSpec } from "./generation-discussion.js";

const componentId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const toolContractId = "33333333-3333-4333-8333-333333333333";
const requirementDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const contractDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

type CandidateOverrides = Partial<{
  enabled: boolean;
  lifecycleState: string;
  activationState: string;
  operationalState: string;
  ready: boolean;
  principalStatus: string;
  validationState: string | null;
}>;

const candidate = (eligible: boolean, overrides: CandidateOverrides = {}) => ({
  componentId, code: "KCML9001", displayName: "Catalog", purpose: "Catalog lookup", revisionId, revision: "r1", manifestDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", capabilities: ["catalogue.read"],
  tools: [{ contractId: toolContractId, name: "lookup", title: "Lookup", description: "Reads catalog", inputSchema: { type: "object" }, outputSchema: { type: "object" }, requiredScope: "component.read", contractDigest }],
  contractMatch: "CANDIDATE" as const, runtimeEligibility: eligible ? "ELIGIBLE" as const : "INELIGIBLE" as const, eligibilityReasons: eligible ? [] : ["disabled"], enabled: overrides.enabled ?? eligible, lifecycleState: overrides.lifecycleState ?? "ACTIVE", activationState: overrides.activationState ?? "ACTIVE", operationalState: overrides.operationalState ?? "HEALTHY", ready: overrides.ready ?? eligible, principalStatus: overrides.principalStatus ?? "ACTIVE", validationState: overrides.validationState === undefined ? "APPROVED" : overrides.validationState
});

type CapabilityDecision = NonNullable<GenerationSpec["capabilityDecisions"]>[number];
const spec = (decision: CapabilityDecision["decision"], reuse = true, missingDelta: string[] = []): GenerationSpec => ({
  objective: "Use capability", resultSummary: "Use existing capability", behavioralRequirements: ["Read catalog"], inputsAndOutputs: ["typed result"], externalSystems: [], businessRules: [], explicitOwnerDecisions: [], constraints: [], acceptanceCriteria: [], verifiedFacts: [], openQuestions: [], browserAutomations: [],
  capabilityDecisions: [{ requirementDigest, decision, reuse: reuse ? [{ componentId, revisionId, toolContractId, contractDigest }] : [], reusableBehavior: reuse ? ["Read catalog"] : [], missingDelta, permissionDelta: [] }]
});

const evidence = (inspected: Map<string, ReturnType<typeof candidate>>, candidates = new Set([componentId])): CapabilityTurnEvidence => ({ requirementDigest, inputMessageId: "44444444-4444-4444-8444-444444444444", candidateIds: candidates, inspected, lookupEventSequence: 3 });

describe("server capability-first proposal guard", () => {
  it("returns field-level safe diagnostics for a malformed proposal", () => {
    const invalid = { objective: "sensitive-value-must-not-leak" };
    const result = validateCapabilityProposal(invalid, evidence(new Map(), new Set()));
    expect(result).toMatch(/^generation_specification_invalid:/);
    expect(result).toContain("resultSummary:invalid_type:expected_string");
    expect(result).not.toContain("sensitive-value-must-not-leak");
  });

  it("returns an actionable expected collection type without echoing submitted values", () => {
    const invalid = {
      ...spec("NEW_CAPABILITY_REQUIRED", false),
      browserAutomations: [{ navigationPolicy: { downloadOrigins: "sensitive-origin-must-not-leak" } }]
    };
    const result = validateCapabilityProposal(invalid, evidence(new Map(), new Set()));
    expect(result).toContain("browserAutomations.0.navigationPolicy.downloadOrigins:invalid_type:expected_array");
    expect(result).not.toContain("sensitive-origin-must-not-leak");
  });

  it("rejects a proposal before lookup or before relevant contract inspection", () => {
    expect(validateCapabilityProposal(spec("NEW_CAPABILITY_REQUIRED", false), null)).toBe("CAPABILITY_LOOKUP_REQUIRED");
    expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(new Map()))).toBe("CAPABILITY_CONTRACT_INSPECTION_REQUIRED");
  });

  it("allows exact eligible reuse and partial reuse only with a missing delta", () => {
    const inspected = new Map([[componentId, candidate(true)]]);
    expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(inspected))).toBeNull();
    expect(validateCapabilityProposal(spec("PARTIAL_REUSE", true, ["write path"]), evidence(inspected))).toBeNull();
    expect(validateCapabilityProposal(spec("PARTIAL_REUSE"), evidence(inspected))).toBe("CAPABILITY_DECISION_INVALID");
  });

  it("rejects ineligible, stale or hallucinated references", () => {
    expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(new Map([[componentId, candidate(false)]])))).toBe("CAPABILITY_FULL_REUSE_INELIGIBLE");
    const stale = { ...candidate(true), revisionId: "55555555-5555-4555-8555-555555555555" };
    expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(new Map([[componentId, stale]])))).toBe("CAPABILITY_REFERENCE_INVALID");
    const unknown = { ...spec("FULL_REUSE"), capabilityDecisions: [{ ...spec("FULL_REUSE").capabilityDecisions![0], reuse: [{ componentId: "66666666-6666-4666-8666-666666666666", revisionId, toolContractId, contractDigest }] }] };
    expect(validateCapabilityProposal(unknown, evidence(new Map([[componentId, candidate(true)]]), new Set([componentId])))).toBe("CAPABILITY_REFERENCE_INVALID");
    const wrongTool = { ...spec("FULL_REUSE"), capabilityDecisions: [{ ...spec("FULL_REUSE").capabilityDecisions![0], reuse: [{ componentId, revisionId, toolContractId: "77777777-7777-4777-8777-777777777777", contractDigest }] }] };
    expect(validateCapabilityProposal(wrongTool, evidence(new Map([[componentId, candidate(true)]])))).toBe("CAPABILITY_REFERENCE_INVALID");
  });

  it("rejects every canonical runtime eligibility blocker independently", () => {
    const blockers: Array<[string, CandidateOverrides]> = [
      ["readiness", { ready: false }],
      ["component-disabled", { enabled: false }],
      ["lifecycle", { lifecycleState: "QUARANTINED" }],
      ["activation", { activationState: "INACTIVE" }],
      ["operational", { operationalState: "DEGRADED" }],
      ["principal", { principalStatus: "REVOKED" }],
      ["revision-validation", { validationState: "FAILED" }]
    ];
    for (const [name, overrides] of blockers) {
      const blocked = candidate(false, overrides);
      expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(new Map([[componentId, blocked]])))).toBe("CAPABILITY_FULL_REUSE_INELIGIBLE");
      expect(name).toBeTruthy();
    }
  });

  it("permits a no-candidate NEW decision after lookup evidence", () => {
    const proposal = { ...spec("NEW_CAPABILITY_REQUIRED", false), capabilityDecisions: [{ ...spec("NEW_CAPABILITY_REQUIRED", false).capabilityDecisions![0], missingDelta: ["No canonical capability provides this behavior."] }] };
    expect(validateCapabilityProposal(proposal, evidence(new Map(), new Set()))).toBeNull();
  });

  it("keeps a permission-only gap on the existing capability", () => {
    const permissionOnly = { ...spec("FULL_REUSE"), capabilityDecisions: [{ ...spec("FULL_REUSE").capabilityDecisions![0], permissionDelta: ["component.catalog.read"] }] };
    expect(validateCapabilityProposal(permissionOnly, evidence(new Map([[componentId, candidate(true)]])))).toBeNull();
    expect(permissionOnly.capabilityDecisions?.[0]?.reuse).toHaveLength(1);
  });

  it("scopes lookup evidence to the current OWNER turn", () => {
    const inspected = new Map([[componentId, candidate(true)]]);
    expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(inspected), { messageId: "55555555-5555-4555-8555-555555555555", requirementDigest })).toBe("CAPABILITY_LOOKUP_REQUIRED");
    expect(validateCapabilityProposal(spec("FULL_REUSE"), evidence(inspected), { messageId: "44444444-4444-4444-8444-444444444444", requirementDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" })).toBe("CAPABILITY_LOOKUP_REQUIRED");
  });
});
