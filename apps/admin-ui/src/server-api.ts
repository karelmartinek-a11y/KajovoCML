import type { AlertDelivery, Component, ManagedSecret, MonitoringProfile, OperationalAlert, SecretGrant, SecretVersion, Server } from "./types.js";
import { api, csrf } from "./ui-helpers.js";

const mutationHeaders = (): HeadersInit => ({ "x-csrf-token": csrf() });

export type ServerTestCheckpointKey =
  | "contract"
  | "input_validation"
  | "runtime_lease"
  | "handler_run"
  | "output_validation"
  | "result_match"
  | "activation";

export type ServerTestCheckpoint = {
  key: ServerTestCheckpointKey;
  label: string;
  description: string;
  status: "PENDING" | "PASSED" | "FAILED" | "SKIPPED";
  detail?: string;
  durationMs?: number;
};

export type ServerTestResult = {
  ok: boolean;
  status: "PASSED" | "EXPECTED_RESULT_MISMATCH" | "FAILED";
  correlationId: string;
  latencyMs: number;
  activeRevisionId: string;
  manifestDigest: string;
  checkpoints: ServerTestCheckpoint[];
  errorCode?: string;
  errorMessage?: string;
  failedCheckpointKey?: ServerTestCheckpointKey;
  output?: unknown;
};

export async function setServerEnabled(server: Server, enabled: boolean): Promise<void> {
  await api(`/api/mcp-servers/${server.id}/enabled`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ enabled })
  });
}

export async function setComponentEnabled(component: Component, enabled: boolean): Promise<Component> {
  const response = await api<{ component: Component }>(`/api/components/${component.id}/activation`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ enabled })
  });
  return response.component;
}

export async function setComponentLifecycle(component: Component, action: "QUARANTINE" | "RESTORE" | "RETIRE" | "DEREGISTER"): Promise<Component> {
  const response = await api<{ component: Component }>(`/api/components/${component.id}/lifecycle`, {
    method: "POST", headers: mutationHeaders(), body: JSON.stringify({ action })
  });
  return response.component;
}

export async function setComponentPermission(component: Component, permissionId: string, enabled: boolean): Promise<Component> {
  const response = await api<{ component: Component }>(`/api/components/${component.id}/permissions/${permissionId}`, {
    method: "POST", headers: mutationHeaders(), body: JSON.stringify({ enabled })
  });
  return response.component;
}

export async function revokeComponentAccessToken(component: Component, tokenId: string): Promise<Component> {
  const response = await api<{ component: Component }>(`/api/components/${component.id}/access-tokens/${tokenId}/revoke`, {
    method: "POST", headers: mutationHeaders(), body: "{}"
  });
  return response.component;
}

export async function rotateComponentAccessToken(component: Component, tokenId: string): Promise<{
  component: Component;
  accessToken: { token: string; fingerprint: string };
}> {
  return api(`/api/components/${component.id}/access-tokens/${tokenId}/rotate`, {
    method: "POST", headers: mutationHeaders(), body: "{}"
  });
}

export async function runComponentE2E(component: Component): Promise<void> {
  await api(`/api/components/${component.id}/e2e-runs`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function runComponentStateQuery(component: Component): Promise<void> {
  await api(`/api/components/${component.id}/state-queries`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function runComponentHeartbeatChallenge(component: Component): Promise<void> {
  await api(`/api/components/${component.id}/heartbeat-challenges`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function runRegisteredServerTest(server: Server): Promise<ServerTestResult> {
  return api<ServerTestResult>(`/api/mcp-servers/${server.id}/test`, {
    method: "POST",
    headers: mutationHeaders(),
    body: "{}"
  });
}

export function getMonitoringProfile(server: Server): Promise<MonitoringProfile> {
  return api<MonitoringProfile>(`/api/mcp-servers/${server.id}/monitoring-profile`);
}

export async function persistMonitoringProfile(server: Server, profile: MonitoringProfile): Promise<void> {
  const body = JSON.stringify({ enabled: true, expectedVersion: profile.version, profile: profile.profile });
  await api(`/api/mcp-servers/${server.id}/monitoring-profile/preview`, {
    method: "POST",
    headers: mutationHeaders(),
    body
  });
  await api(`/api/mcp-servers/${server.id}/monitoring-profile`, {
    method: "PUT",
    headers: mutationHeaders(),
    body
  });
}

export async function createServerRevision(server: Server): Promise<string> {
  const result = await api<{ jobId: string }>(`/api/mcp-servers/${server.id}/revisions`, {
    method: "POST",
    headers: mutationHeaders(),
    body: "{}"
  });
  return result.jobId;
}

export async function testAlertChannels(): Promise<void> {
  await api("/api/alerts/test", { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function acknowledgeOperationalAlert(alert: OperationalAlert): Promise<void> {
  await api(`/api/alerts/${alert.id}/acknowledge`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function suppressOperationalAlert(alert: OperationalAlert, reason: string, until: string): Promise<void> {
  await api(`/api/alerts/${alert.id}/suppress`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ reason, until })
  });
}

export async function retryAlertDelivery(delivery: AlertDelivery): Promise<void> {
  await api(`/api/alert-deliveries/${delivery.id}/retry`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export function createManagedSecret(input: {
  stableName: string;
  displayName: string;
  description: string;
  value: string;
}): Promise<{ secret: ManagedSecret }> {
  return api<{ secret: ManagedSecret }>("/api/secrets", {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input)
  });
}

export function rotateManagedSecret(secret: ManagedSecret, value: string): Promise<{ secret: ManagedSecret }> {
  return api<{ secret: ManagedSecret }>(`/api/secrets/${secret.id}/rotate`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ value, expectedVersion: secret.lockVersion })
  });
}

export async function deleteManagedSecret(secret: ManagedSecret): Promise<void> {
  await api(`/api/secrets/${secret.id}/delete`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedVersion: secret.lockVersion })
  });
}

export function setManagedSecretStatus(secret: ManagedSecret, status: "ACTIVE" | "DISABLED"): Promise<{ secret: ManagedSecret }> {
  return api<{ secret: ManagedSecret }>(`/api/secrets/${secret.id}/status`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ status, expectedVersion: secret.lockVersion })
  });
}

export function restoreManagedSecret(secret: ManagedSecret): Promise<{ secret: ManagedSecret }> {
  return api<{ secret: ManagedSecret }>(`/api/secrets/${secret.id}/restore`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ expectedVersion: secret.lockVersion })
  });
}

export function listSecretVersions(secret: ManagedSecret): Promise<{ versions: SecretVersion[] }> {
  return api<{ versions: SecretVersion[] }>(`/api/secrets/${secret.id}/versions`);
}

export function listSecretGrants(secret: ManagedSecret): Promise<{ grants: SecretGrant[] }> {
  return api<{ grants: SecretGrant[] }>(`/api/secrets/${secret.id}/grants`);
}

export function grantManagedSecret(secret: ManagedSecret, input: {
  principalKind: SecretGrant["principalKind"];
  principalId?: string | null;
  principalPublicId?: string | null;
  allSecrets?: boolean;
}): Promise<{ grants: SecretGrant[] }> {
  return api<{ grants: SecretGrant[] }>(`/api/secrets/${secret.id}/grants`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input)
  });
}

export async function revokeManagedSecretGrant(grant: SecretGrant): Promise<void> {
  await api(`/api/secret-grants/${grant.id}/revoke`, {
    method: "POST",
    headers: mutationHeaders(),
    body: "{}"
  });
}

export function createSecretRevealGrant(secret: ManagedSecret, input: { password: string; totp: string; purpose: string }): Promise<{ revealGrantId: string; expiresAt: string }> {
  return api<{ revealGrantId: string; expiresAt: string }>(`/api/secrets/${secret.id}/reveal-grants`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify(input)
  });
}

export function revealManagedSecret(secret: ManagedSecret, revealGrantId: string): Promise<{ value: string; expiresAt: string; version: number; fingerprint: string }> {
  return api<{ value: string; expiresAt: string; version: number; fingerprint: string }>(`/api/secrets/${secret.id}/reveal`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ revealGrantId })
  });
}

export async function auditSecretRevealUiEvent(secret: ManagedSecret, eventType: "copy" | "cut" | "contextmenu" | "blur" | "visibility_hidden" | "expired" | "cleared", revealGrantId?: string | null): Promise<void> {
  await api(`/api/secrets/${secret.id}/reveal-events`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ eventType, revealGrantId: revealGrantId ?? null })
  });
}

export async function loadDashboardTopology(): Promise<import("./types.js").DashboardTopology> {
  const response = await api<{ topology: import("./types.js").DashboardTopology }>("/api/dashboard/topology");
  return response.topology;
}

export async function saveDashboardLayout(input: {
  expectedVersion?: number;
  viewport: { x: number; y: number; zoom: number };
  positions: Array<{ nodeId: string; x: number; y: number }>;
}): Promise<{ lock_version: number }> {
  const response = await api<{ layout: { lock_version: number } }>("/api/dashboard/layout", {
    method: "PUT", headers: mutationHeaders(), body: JSON.stringify(input)
  });
  return response.layout;
}

export async function previewDashboardConnection(input: {
  sourceComponentId: string; sourcePortKey: string; targetComponentId: string; targetPortKey: string;
}): Promise<unknown> {
  return api("/api/dashboard/connections/preview", { method: "POST", headers: mutationHeaders(), body: JSON.stringify(input) });
}

export async function createDashboardConnection(input: {
  sourceComponentId: string; sourcePortKey: string; targetComponentId: string; targetPortKey: string;
  targetRoute?: string; targetScope?: string; grantAuthorization?: boolean;
}): Promise<void> {
  await api("/api/dashboard/connections", { method: "POST", headers: mutationHeaders(), body: JSON.stringify(input) });
}

export async function setDashboardConnectionAuthorization(connectionId: string, enabled: boolean): Promise<void> {
  await api(`/api/dashboard/connections/${connectionId}/authorization`, { method: "PUT", headers: mutationHeaders(), body: JSON.stringify({ enabled }) });
}

export async function disconnectDashboardConnection(connectionId: string): Promise<void> {
  await api(`/api/dashboard/connections/${connectionId}`, { method: "DELETE", headers: mutationHeaders() });
}

export async function setDashboardNodeSuspension(nodeId: string, suspended: boolean, reason: string): Promise<void> {
  await api(`/api/dashboard/nodes/${nodeId}/suspension`, { method: "PUT", headers: mutationHeaders(), body: JSON.stringify({ suspended, reason }) });
}

export async function setDashboardComponentEnabled(componentId: string, enabled: boolean): Promise<void> {
  await api(`/api/components/${componentId}/activation`, { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ enabled }) });
}

export async function setDashboardComponentLifecycle(componentId: string, action: "QUARANTINE" | "RESTORE" | "RETIRE"): Promise<void> {
  await api(`/api/components/${componentId}/lifecycle`, { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ action }) });
}

export async function runDashboardComponentE2E(componentId: string): Promise<void> {
  await api(`/api/components/${componentId}/e2e-runs`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function runDashboardComponentStateQuery(componentId: string): Promise<void> {
  await api(`/api/components/${componentId}/state-queries`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function runDashboardComponentHeartbeatChallenge(componentId: string): Promise<void> {
  await api(`/api/components/${componentId}/heartbeat-challenges`, { method: "POST", headers: mutationHeaders(), body: "{}" });
}

export async function loadDashboardDeregistrationPreview(nodeId: string): Promise<import("./types.js").DashboardDeregistrationPreview> {
  const response = await api<{ preview: import("./types.js").DashboardDeregistrationPreview }>(`/api/dashboard/nodes/${nodeId}/deregistration-preview`);
  return response.preview;
}

export async function deregisterDashboardNode(nodeId: string, input: {
  password: string;
  totp: string;
  reason: string;
  confirmedCode: string;
  idempotencyKey: string;
}): Promise<{ componentCode: string; cleanup: Record<string, number>; correlationId: string }> {
  const response = await api<{ result: { componentCode: string; cleanup: Record<string, number>; correlationId: string } }>(`/api/dashboard/nodes/${nodeId}/deregister`, {
    method: "POST", headers: mutationHeaders(), body: JSON.stringify(input)
  });
  return response.result;
}

export async function grantDashboardSecret(secretId: string, nodeId: string): Promise<void> {
  await api(`/api/dashboard/secrets/${secretId}/grants`, { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ nodeId }) });
}

export async function revokeDashboardSecret(secretId: string, nodeId: string): Promise<void> {
  await api(`/api/dashboard/secrets/${secretId}/grants/${nodeId}`, { method: "DELETE", headers: mutationHeaders() });
}

export async function previewBulkDashboardSecret(secretId: string): Promise<import("./types.js").DashboardSecretBulkPreview> {
  const response = await api<{ preview: import("./types.js").DashboardSecretBulkPreview }>(`/api/dashboard/secrets/${secretId}/grants/bulk-preview`);
  return response.preview;
}

export async function bulkGrantDashboardSecret(secretId: string): Promise<{ targetCount: number; skippedCount: number; results: Array<{ nodeId: string; status: string; reason?: string }> }> {
  const response = await api<{ result: { targetCount: number; skippedCount: number; results: Array<{ nodeId: string; status: string; reason?: string }> } }>(`/api/dashboard/secrets/${secretId}/grants/bulk`, {
    method: "POST", headers: mutationHeaders(), body: "{}"
  });
  return response.result;
}

export async function createDashboardSecretRevealGrant(secretId: string, input: { password: string; totp: string; purpose: string }): Promise<{ revealGrantId: string; expiresAt: string }> {
  return api(`/api/secrets/${secretId}/reveal-grants`, { method: "POST", headers: mutationHeaders(), body: JSON.stringify(input) });
}

export async function revealDashboardSecret(secretId: string, revealGrantId: string): Promise<{ value: string; expiresAt: string; version: number; fingerprint: string }> {
  return api(`/api/secrets/${secretId}/reveal`, { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ revealGrantId }) });
}

export async function auditDashboardSecretRevealEvent(secretId: string, eventType: "blur" | "visibility_hidden" | "expired" | "cleared", revealGrantId?: string | null): Promise<void> {
  await api(`/api/secrets/${secretId}/reveal-events`, { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ eventType, revealGrantId: revealGrantId ?? null }) });
}

export async function listDashboardIdentityCards(): Promise<import("./types.js").DashboardIdentityCard[]> {
  const response = await api<{ identities: import("./types.js").DashboardIdentityCard[] }>("/api/dashboard/identity-cards");
  return response.identities;
}
