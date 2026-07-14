export type Page = "monitoring" | "integration" | "tokens" | "permissions" | "audit" | "config" | "security" | "admins";
export type Session = { authenticated: boolean; account: string | null; bootstrapRequired?: boolean };
export type Server = {
  id: string;
  code: string;
  hostname: string;
  displayName: string;
  description: string;
  toolName: string;
  registrationState: string;
  operationalState: string;
  enabled: boolean;
  handlerKey: string;
  handlerVersion: string;
  contractVersion: string;
  inputSchema: unknown;
  outputSchema: unknown;
  artifactDigest: string;
  manifestDigest: string;
  successCount: number;
  unauthorizedCount: number;
  failureCount: number;
  lastLatencyMs: number | null;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastUnauthorizedAt: string | null;
  registrationRevision: string | null;
  reviewDueAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type KajaCredential = {
  id: string;
  publicId: string;
  label: string;
  fingerprint: string;
  active: boolean;
  revokedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  permissionCount: number;
  activeAccessTokenCount: number;
  lastTokenIssuedAt: string | null;
  lastTokenExpiresAt: string | null;
  lastUsedAt: string | null;
};
export type AccessLevel = "EXECUTE";
export type KajaPermission = {
  serverId: string;
  code: string;
  hostname: string;
  displayName: string;
  granted: boolean;
  accessLevel: AccessLevel | null;
  grantedAt: string | null;
};
export type AuditEvent = {
  id: number;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  object_type: string;
  object_id: string;
  correlation_id: string;
  created_at: string;
  before_json?: unknown;
  after_json?: unknown;
};
export type SecretResult = { publicId: string; label: string; clientSecret: string; fingerprint: string; expiresAt: string | null };
export type IntegrationToken = {
  id: string;
  label: string;
  fingerprint: string;
  descriptor: {
    summary: string;
    businessPurpose: string;
    serviceOwner: string;
    technicalOwner: string;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };
  jobId: string | null;
  issuedAt: string;
  initialExpiresAt: string;
  expiresAt: string;
  maxExpiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
  jobState: string | null;
  code: string | null;
  hostname: string | null;
  heartbeatAt: string | null;
  tokenExtendedAt: string | null;
};
export type IntegrationSecret = IntegrationToken & {
  token: string;
  onboardingCatalogUrl: string;
  onboardingCatalogFileName: string;
  programmerApiUrl: string;
};
export type OnboardingGate = { gate_name: string; stage: string; status: string; evidence: Record<string, unknown>; correlation_id: string; started_at: string | null; completed_at: string | null };
export type OnboardingEvent = { id: number; from_state: string | null; to_state: string; event_type: string; detail: Record<string, unknown>; correlation_id: string; created_at: string };
export type OnboardingJob = {
  id: string;
  state: string;
  correlationId: string;
  lockVersion: number;
  sourceRevision: number;
  code: string | null;
  hostname: string | null;
  resource: string | null;
  toolName: string | null;
  serverId: string | null;
  githubPrUrl: string | null;
  imageDigest: string | null;
  sbomDigest: string | null;
  blockingErrorCode: string | null;
  blockingErrorDetail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  gates?: OnboardingGate[];
  events?: OnboardingEvent[];
};
export type MonitoringProbe = { id: number; server_id: string; code: string; hostname: string; probe_type: string; status: string; latency_ms: number | null; correlation_id: string; checked_at: string };
export type AuditResponse = { events: AuditEvent[]; nextCursor: string | null };
export type AuditIntegrity = {
  valid: boolean;
  eventCount: number;
  latestEventId: number | null;
  brokenEventId: number | null;
};
export type AdminSecurity = {
  username: string;
  passwordChangedAt: string | null;
  sessions: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
    current: boolean;
  }>;
};
export type AdminAccount = {
  id: string;
  username: string;
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  activeSessionCount: number;
  recoveryCodeCount: number;
  current: boolean;
};
export type MonitoringProfile = {
  enabled: boolean;
  profile: {
    sloTargets: Record<string, unknown>;
    probeIntervals: Record<string, unknown>;
    alertRules: Array<Record<string, unknown>>;
    runbookRef: string;
    primaryAlertChannel: string;
    backupAlertChannel: string;
  };
};
export type OperationalConfigSetting = {
  key: string;
  envKey: string;
  label: string;
  kind: "string" | "number" | "boolean" | "secret";
  restartRequired: boolean;
  bootstrapOnly: boolean;
  source: "database" | "bootstrap";
  value: string | number | boolean | null;
  fingerprint: string | null;
  updatedAt: string | null;
};
export type OnboardingDescriptor = {
  summary: string;
  businessPurpose: string;
  serviceOwner: string;
  technicalOwner: string;
  criticality: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export const pageNames: Record<Page, string> = {
  monitoring: "Monitoring MCP",
  integration: "Implementační tokeny",
  tokens: "Klientská pověření Kaja",
  permissions: "Správa oprávnění",
  audit: "Audit",
  config: "Konfigurace",
  security: "Bezpečnost",
  admins: "Administrátoři"
};

export const accessLabels: Record<AccessLevel, string> = {
  EXECUTE: "Spouštění"
};
