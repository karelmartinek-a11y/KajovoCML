import { z } from "zod";
import type { OperationalState } from "./types.js";

export const monitoringProbeNames = [
  "liveness",
  "readiness",
  "tls",
  "routing",
  "oauth_mcp",
  "synthetic_call",
  "artifact_integrity",
  "contract_profile_drift",
  "dependencies"
] as const;

export const monitoringPolicySchema = z.object({
  sloTargets: z.object({
    availabilityPercent: z.number().min(90).max(100),
    p95LatencyMs: z.number().int().min(1).max(60_000),
    maxErrorRatePercent: z.number().min(0).max(100)
  }).strict(),
  probeIntervals: z.object({
    readinessSeconds: z.number().int().min(15).max(300),
    tlsSeconds: z.number().int().min(60).max(3_600),
    routingSeconds: z.number().int().min(15).max(300),
    oauthMcpSeconds: z.number().int().min(30).max(600),
    syntheticCallSeconds: z.number().int().min(60).max(900),
    integritySeconds: z.number().int().min(60).max(900),
    dependenciesSeconds: z.number().int().min(30).max(900)
  }).strict(),
  staleAfterSeconds: z.number().int().min(30).max(7_200),
  alertRules: z.array(z.object({
    probeType: z.enum(monitoringProbeNames),
    severity: z.enum(["WARNING", "HIGH", "CRITICAL"]),
    consecutiveFailures: z.number().int().min(1).max(20)
  }).strict()).min(1).max(50),
  runbookRef: z.string().trim().min(3).max(500),
  primaryAlertChannel: z.string().trim().min(3).max(200),
  backupAlertChannel: z.string().trim().min(3).max(200),
  retentionDays: z.number().int().min(1).max(3_650).default(30)
}).strict();

export const monitoringProfileUpdateSchema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().min(0),
  profile: monitoringPolicySchema
}).strict();

export type MonitoringPolicy = z.infer<typeof monitoringPolicySchema>;

export type OperationalStateEvaluation = {
  state: Extract<OperationalState, "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN">;
  reasonCode: string;
  evaluatedAt: string;
  sampleCount: number;
};

export function evaluateOperationalState(input: {
  currentState: OperationalState;
  samples: Array<{ status: "PASS" | "FAIL" | "STALE"; critical: boolean }>;
  previousFailureStreak: number;
  minimumSamples?: number;
  evaluatedAt: string;
}): OperationalStateEvaluation {
  const minimumSamples = input.minimumSamples ?? 3;
  const current = ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"].includes(input.currentState)
    ? input.currentState as OperationalStateEvaluation["state"]
    : "UNKNOWN";
  if (input.samples.length < minimumSamples) {
    return { state: current, reasonCode: "INSUFFICIENT_SAMPLES", evaluatedAt: input.evaluatedAt, sampleCount: input.samples.length };
  }
  const failed = input.samples.filter((sample) => sample.status === "FAIL");
  if (failed.some((sample) => sample.critical) && input.previousFailureStreak + 1 >= 2) {
    return { state: "UNHEALTHY", reasonCode: "CRITICAL_PROBE_FAILURE_STREAK", evaluatedAt: input.evaluatedAt, sampleCount: input.samples.length };
  }
  if (failed.length || input.samples.some((sample) => sample.status === "STALE")) {
    return { state: "DEGRADED", reasonCode: failed.length ? "PROBE_FAILURE" : "STALE_PROBE", evaluatedAt: input.evaluatedAt, sampleCount: input.samples.length };
  }
  if (current === "UNHEALTHY" || input.previousFailureStreak > 0) {
    return { state: "DEGRADED", reasonCode: "RECOVERY_HYSTERESIS", evaluatedAt: input.evaluatedAt, sampleCount: input.samples.length };
  }
  return { state: "HEALTHY", reasonCode: "ALL_DUE_PROBES_PASS", evaluatedAt: input.evaluatedAt, sampleCount: input.samples.length };
}
