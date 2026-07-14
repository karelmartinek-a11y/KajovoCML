export type RecertificationPhase = "VALID" | "WARNING" | "GRACE" | "SUSPENDED" | "INVALID";

export type RecertificationInput = {
  activeRevisionId: string | null;
  validationState: string | null;
  approvedAt: string | null;
  reviewDueAt: string | null;
  reviewIntervalDays: number | null;
};

export type RecertificationDecision = {
  phase: RecertificationPhase;
  canServeExisting: boolean;
  canActivate: boolean;
  shouldSuspend: boolean;
  reason: string | null;
  reviewDueAt: string | null;
  secondsToBoundary: number | null;
};

const DAY_MS = 86_400_000;

function invalid(reason: string, reviewDueAt: string | null): RecertificationDecision {
  return {
    phase: "INVALID",
    canServeExisting: false,
    canActivate: false,
    shouldSuspend: false,
    reason,
    reviewDueAt,
    secondsToBoundary: null
  };
}

export function evaluateRecertification(input: RecertificationInput, now = new Date()): RecertificationDecision {
  if (!input.activeRevisionId) return invalid("active_registration_revision_missing", input.reviewDueAt);
  if (input.validationState !== "VALID") return invalid("registration_revision_invalid", input.reviewDueAt);
  if (!Number.isInteger(input.reviewIntervalDays) || !input.reviewIntervalDays || input.reviewIntervalDays < 1 || input.reviewIntervalDays > 365) {
    return invalid("review_interval_invalid", input.reviewDueAt);
  }
  const approvedAt = input.approvedAt ? new Date(input.approvedAt) : null;
  const reviewDueAt = input.reviewDueAt ? new Date(input.reviewDueAt) : null;
  if (!approvedAt || !Number.isFinite(approvedAt.getTime())) return invalid("review_approval_missing", input.reviewDueAt);
  if (!reviewDueAt || !Number.isFinite(reviewDueAt.getTime())) return invalid("review_due_at_invalid", input.reviewDueAt);
  const expectedDueAt = approvedAt.getTime() + input.reviewIntervalDays * DAY_MS;
  if (Math.abs(expectedDueAt - reviewDueAt.getTime()) > 60_000) return invalid("review_interval_drift", input.reviewDueAt);

  const nowMs = now.getTime();
  const warningAt = reviewDueAt.getTime() - 30 * DAY_MS;
  const suspendedAt = reviewDueAt.getTime() + 30 * DAY_MS;
  if (nowMs < warningAt) {
    return {
      phase: "VALID",
      canServeExisting: true,
      canActivate: true,
      shouldSuspend: false,
      reason: null,
      reviewDueAt: reviewDueAt.toISOString(),
      secondsToBoundary: Math.ceil((warningAt - nowMs) / 1_000)
    };
  }
  if (nowMs < reviewDueAt.getTime()) {
    return {
      phase: "WARNING",
      canServeExisting: true,
      canActivate: true,
      shouldSuspend: false,
      reason: "recertification_due_within_30_days",
      reviewDueAt: reviewDueAt.toISOString(),
      secondsToBoundary: Math.ceil((reviewDueAt.getTime() - nowMs) / 1_000)
    };
  }
  if (nowMs < suspendedAt) {
    return {
      phase: "GRACE",
      canServeExisting: true,
      canActivate: false,
      shouldSuspend: false,
      reason: "recertification_overdue_grace",
      reviewDueAt: reviewDueAt.toISOString(),
      secondsToBoundary: Math.ceil((suspendedAt - nowMs) / 1_000)
    };
  }
  return {
    phase: "SUSPENDED",
    canServeExisting: false,
    canActivate: false,
    shouldSuspend: true,
    reason: "recertification_overdue_30_days",
    reviewDueAt: reviewDueAt.toISOString(),
    secondsToBoundary: 0
  };
}
