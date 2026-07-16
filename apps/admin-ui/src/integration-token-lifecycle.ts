const EXTENDING_JOB_STATES = new Set([
  "CREATED",
  "SOURCE_UPLOADED",
  "PR_CREATED",
  "CI_RUNNING",
  "MERGED",
  "ARTIFACT_BUILDING",
  "DEPLOYING",
  "REGISTERED_DISABLED",
  "TRIAL_TESTING"
]);

const HEARTBEAT_FRESH_MS = 90_000;
const NEAR_MAXIMUM_MS = 2 * 60 * 60 * 1000;

export type IntegrationTokenLifecycleInput = {
  issuedAt: string;
  expiresAt: string;
  maxExpiresAt: string;
  revokedAt: string | null;
  jobId: string | null;
  jobState: string | null;
  heartbeatAt: string | null;
};

export type IntegrationRunState = "waiting" | "running" | "starting" | "paused" | "completed" | "inactive";

export type IntegrationTokenLifecycle = {
  currentRemainingMs: number;
  maximumRemainingMs: number;
  maximumProgressPercent: number;
  nearMaximum: boolean;
  tokenValid: boolean;
  runState: IntegrationRunState;
  runLabel: string;
  protectionLabel: string;
  protectionActive: boolean;
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function getIntegrationTokenLifecycle(token: IntegrationTokenLifecycleInput, nowMs: number): IntegrationTokenLifecycle {
  const issuedAtMs = timestamp(token.issuedAt) ?? nowMs;
  const expiresAtMs = timestamp(token.expiresAt) ?? 0;
  const maxExpiresAtMs = timestamp(token.maxExpiresAt) ?? issuedAtMs;
  const heartbeatAtMs = timestamp(token.heartbeatAt);
  const currentRemainingMs = Math.max(0, expiresAtMs - nowMs);
  const maximumRemainingMs = Math.max(0, maxExpiresAtMs - nowMs);
  const maximumDurationMs = Math.max(1, maxExpiresAtMs - issuedAtMs);
  const maximumProgressPercent = Math.min(100, Math.max(0, ((nowMs - issuedAtMs) / maximumDurationMs) * 100));
  const tokenValid = !token.revokedAt && currentRemainingMs > 0;
  const heartbeatFresh = heartbeatAtMs !== null && heartbeatAtMs <= nowMs + 5_000 && heartbeatAtMs >= nowMs - HEARTBEAT_FRESH_MS;
  const extensionEligible = tokenValid && token.jobState !== null && EXTENDING_JOB_STATES.has(token.jobState);

  let runState: IntegrationRunState;
  let runLabel: string;
  let protectionLabel: string;
  let protectionActive = false;

  if (!tokenValid) {
    runState = "inactive";
    runLabel = token.revokedAt ? "Token revokován" : "Platnost skončila";
    protectionLabel = "Automatické prodloužení vypnuto";
  } else if (!token.jobId) {
    runState = "waiting";
    runLabel = "Integrace nezahájena";
    protectionLabel = "Prodloužení začne až s integračním jobem";
  } else if (token.jobState === "ACTIVE") {
    runState = "completed";
    runLabel = "Integrace dokončena";
    protectionLabel = "Automatické prodloužení ukončeno";
  } else if (!extensionEligible) {
    runState = "paused";
    runLabel = token.jobState === "AWAITING_REVISION" ? "Integrace čeká na opravu" : "Integrace neběží";
    protectionLabel = "Automatické prodloužení vypnuto";
  } else if (heartbeatFresh) {
    runState = "running";
    runLabel = "Integrace běží";
    protectionLabel = "Odpočet je chráněn automatickým prodlužováním";
    protectionActive = true;
  } else {
    runState = "starting";
    runLabel = "Integrace čeká na worker";
    protectionLabel = "Prodloužení čeká na heartbeat";
  }

  return {
    currentRemainingMs,
    maximumRemainingMs,
    maximumProgressPercent,
    nearMaximum: maximumRemainingMs > 0 && maximumRemainingMs <= NEAR_MAXIMUM_MS,
    tokenValid,
    runState,
    runLabel,
    protectionLabel,
    protectionActive
  };
}

export function formatMinuteSecondCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${formatCzNumber(minutes)} min ${String(seconds).padStart(2, "0")} s`;
}
import { formatCzNumber } from "./ui-helpers.js";
