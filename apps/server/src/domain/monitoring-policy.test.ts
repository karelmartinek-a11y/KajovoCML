import { describe, expect, it } from "vitest";
import { evaluateOperationalState, monitoringProfileUpdateSchema } from "./monitoring-policy.js";

const evaluatedAt = "2026-07-16T00:00:00.000Z";
const passing = Array.from({ length: 3 }, () => ({ status: "PASS" as const, critical: false }));

describe("operational state evaluator", () => {
  it("keeps the current state until enough samples exist", () => {
    expect(evaluateOperationalState({ currentState: "DEGRADED", samples: passing.slice(0, 2), previousFailureStreak: 0, evaluatedAt })).toMatchObject({ state: "DEGRADED", reasonCode: "INSUFFICIENT_SAMPLES" });
  });

  it("requires a critical failure streak before unhealthy", () => {
    const samples = [{ status: "FAIL" as const, critical: true }, ...passing.slice(1)];
    expect(evaluateOperationalState({ currentState: "HEALTHY", samples, previousFailureStreak: 0, evaluatedAt }).state).toBe("DEGRADED");
    expect(evaluateOperationalState({ currentState: "DEGRADED", samples, previousFailureStreak: 1, evaluatedAt }).state).toBe("UNHEALTHY");
  });

  it("requires a clean recovery cycle before returning healthy", () => {
    expect(evaluateOperationalState({ currentState: "UNHEALTHY", samples: passing, previousFailureStreak: 2, evaluatedAt })).toMatchObject({ state: "DEGRADED", reasonCode: "RECOVERY_HYSTERESIS" });
    expect(evaluateOperationalState({ currentState: "DEGRADED", samples: passing, previousFailureStreak: 0, evaluatedAt }).state).toBe("HEALTHY");
  });
});

describe("monitoring profile schema", () => {
  it("rejects untyped interval and SLO records", () => {
    expect(() => monitoringProfileUpdateSchema.parse({ enabled: true, expectedVersion: 0, profile: { sloTargets: {}, probeIntervals: {}, alertRules: [] } })).toThrow();
  });
});
