import { describe, expect, it } from "vitest";
import { evaluateRecertification } from "./recertification.js";

const DAY = 86_400_000;
const due = new Date("2027-01-01T00:00:00.000Z");
const validInput = {
  activeRevisionId: "revision-1",
  validationState: "VALID",
  approvedAt: new Date(due.getTime() - 180 * DAY).toISOString(),
  reviewDueAt: due.toISOString(),
  reviewIntervalDays: 180
};

describe("recertification evaluator", () => {
  it("uses exact warning, grace and suspended boundaries", () => {
    expect(evaluateRecertification(validInput, new Date(due.getTime() - 30 * DAY - 1)).phase).toBe("VALID");
    expect(evaluateRecertification(validInput, new Date(due.getTime() - 30 * DAY)).phase).toBe("WARNING");
    expect(evaluateRecertification(validInput, new Date(due.getTime() - 1)).phase).toBe("WARNING");
    expect(evaluateRecertification(validInput, new Date(due.getTime())).phase).toBe("GRACE");
    expect(evaluateRecertification(validInput, new Date(due.getTime() + 30 * DAY - 1)).phase).toBe("GRACE");
    expect(evaluateRecertification(validInput, new Date(due.getTime() + 30 * DAY)).phase).toBe("SUSPENDED");
  });

  it("allows existing operations but blocks new activation during grace", () => {
    const decision = evaluateRecertification(validInput, due);
    expect(decision).toMatchObject({ phase: "GRACE", canServeExisting: true, canActivate: false, shouldSuspend: false });
  });

  it("fails closed for missing, drifted or invalid normalized revisions", () => {
    expect(evaluateRecertification({ ...validInput, activeRevisionId: null }).phase).toBe("INVALID");
    expect(evaluateRecertification({ ...validInput, validationState: "INVALID" }).phase).toBe("INVALID");
    expect(evaluateRecertification({ ...validInput, reviewDueAt: "not-a-date" }).phase).toBe("INVALID");
    expect(evaluateRecertification({ ...validInput, reviewIntervalDays: 365 }).reason).toBe("review_interval_drift");
  });
});
