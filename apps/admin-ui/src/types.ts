export type Page = "dashboard" | "generation" | "automations" | "registered" | "identities" | "components" | "external" | "monitoring" | "secrets" | "tokens" | "permissions" | "audit" | "config" | "security" | "admins";
export type AdminRole = "OWNER" | "ADMIN" | "AUDITOR";
export type Session = { authenticated: boolean; account: string | null; role: AdminRole | null; bootstrapRequired?: boolean };
export type ReleaseInfo = {
  applicationVersion: string;
  blueprintVersion: string;
  catalogVersion: string;
  manifestSchemaVersion: string;
  pulseEnvelopeVersion: string;
  policyBaseline: string;
  mcpProtocolVersion: string;
  buildId: string;
  commitSha: string;
};
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
  activeRevisionId: string | null;
  registrationSchemaVersion: string | null;
  registrationValidationState: string | null;
  reviewApprovedAt: string | null;
  reviewDueAt: string | null;
  reviewIntervalDays: number | null;
  monitoringEnabled: boolean;
  monitoringProfileDigest: string | null;
  recertification: {
    phase: "VALID" | "WARNING" | "GRACE" | "SUSPENDED" | "INVALID";
    canServeExisting: boolean;
    canActivate: boolean;
    shouldSuspend: boolean;
    reason: string | null;
    reviewDueAt: string | null;
    secondsToBoundary: number | null;
  };
  createdAt: string;
  updatedAt: string;
};
export type ComponentPermission = {
  id: string;
  source_component_id: string;
  target_component_id: string;
  route_pattern: string;
  scope_name: string;
  access_level: string;
  granted_at: string;
  revoked_at: string | null;
};
export type ComponentAccessToken = {
  id: string;
  fingerprint: string;
  audience: string;
  scope_names: string[];
  issued_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rotated_at: string | null;
  rotation_reason: string | null;
};
export type Component = {
  id: string;
  code: string;
  hostname: string;
  displayName: string;
  description: string;
  category: string;
  registrationType: string;
  role: string;
  owners: Record<string, unknown>;
  contacts: Record<string, unknown>;
  lifecycleState: string;
  activationState: string;
  operationalState: string;
  monitoringState: string;
  recertificationState: string;
  enabled: boolean;
  ingressEnabled: boolean;
  pulseEnabled: boolean;
  egressEnabled: boolean;
  revision: string | null;
  capabilities: string[];
  protocols: string[];
  transports: string[];
  permissionCount: number;
  credentialCount: number;
  policyEpoch: number;
  audit: {
    gapState: string;
    highestReceivedSequence: number;
    highestAcknowledgedSequence: number;
    currentEventHash: string | null;
    integrityState: string;
    integrityReason: string | null;
  };
  releaseVersion: string;
  artifact?: Record<string, unknown> | null;
  manifestDigest?: string | null;
  createdAt: string;
  updatedAt: string;
  permissions?: ComponentPermission[];
  accessTokens?: ComponentAccessToken[];
  readinessGates?: Array<{
    gate_key: string;
    status: string;
    reason_code: string;
    evaluator_version: string;
    evidence: Record<string, unknown>;
    evidence_digest: string;
    correlation_id: string;
    executed_at: string;
    expires_at: string | null;
  }>;
  controlDispatches?: Array<{
    id: string;
    command_type: string;
    target_hostname: string;
    endpoint_path: string;
    request_body: Record<string, unknown>;
    request_digest: string;
    requested_policy_epoch: number;
    expected_state_key: string | null;
    correlation_id: string;
    deadline_at: string;
    state: string;
    final_result: Record<string, unknown> | null;
    final_error_code: string | null;
    attempt_count: number;
    last_attempt_at: string | null;
    ack_digest: string | null;
    created_at: string;
    updated_at: string;
  }>;
  stateObservations?: Array<{
    id: string;
    state_key: string;
    observed_at: string;
    correlation_id: string;
    validation_state: string;
    rejection_reason: string | null;
    declared_client_id: string | null;
    declared_component_code: string | null;
    policy_epoch: number | null;
    state_payload: Record<string, unknown>;
  }>;
  heartbeatHistory?: Array<{
    id: string;
    heartbeat_at: string;
    policy_epoch: number;
    operational_state: string;
    state_digest: string | null;
    correlation_id: string;
    declared_client_id: string | null;
    declared_component_code: string | null;
    validation_state: string;
    rejection_reason: string | null;
    challenge_id: string | null;
    challenge_nonce: string | null;
  }>;
  runtimeTargets?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  endpoints?: Array<Record<string, unknown>>;
  pulseMasks?: Array<Record<string, unknown>>;
  stateContracts?: Array<Record<string, unknown>>;
  stateTransitions?: Array<Record<string, unknown>>;
  stateSnapshots?: Array<Record<string, unknown>>;
  e2eRuns?: Array<Record<string, unknown>>;
  documentation?: Array<Record<string, unknown>>;
  operationLeases?: Array<Record<string, unknown>>;
};
export type ExternalPrincipal = { id: string; publicId: string; displayName: string; description: string; status: string; createdAt: string; revokedAt: string | null; accessTokenCount: number };
export type ExternalTarget = { id: string; targetKey: string; displayName: string; baseUrl: string; auditRequired: boolean; allowedPathPrefixes: string[]; connectTimeoutMs: number; requestTimeoutMs: number; maxRetries: number; circuitState: string; circuitFailureCount: number; circuitFailureThreshold: number; circuitOpenSeconds: number; status: string; createdAt: string; revokedAt: string | null };
export type ExternalPermission = { id: string; component_id: string | null; external_principal_id: string | null; external_target_id: string; route_pattern: string; scope_name: string; granted_at: string; revoked_at: string | null; target_key: string; target_display_name: string; component_code: string | null; external_principal_public_id: string | null };
export type ExternalInboundPermission = { id: string; external_principal_id: string; external_principal_public_id: string; target_component_id: string; target_component_code: string; route_pattern: string; scope_name: string; granted_at: string; revoked_at: string | null };
export type PlatformWorkerAccessStatus = { configured: boolean; fingerprint: string | null; principalPublicId: string; principalStatus: string; rotatedAt: string | null; lastUsedAt: string | null; revokedAt: string | null };
export type ManagedSecret = {
  id: string;
  stableName: string;
  displayName: string;
  description: string;
  ownerKind: string;
  ownerId: string | null;
  status: string;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  activeFingerprint: string | null;
  grantCount: number;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type SecretGrant = {
  id: string;
  principalKind: "KAJA" | "COMPONENT";
  principalId: string | null;
  principalPublicId: string | null;
  allSecrets: boolean;
  grantedAt: string;
  revokedAt: string | null;
};
export type SecretVersion = {
  id: string;
  versionNumber: number;
  fingerprint: string;
  keyId: string;
  algorithm: string;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
  active: boolean;
};
export type AccessTokenCredential = {
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
export type AccessTokenPermission = {
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
  chain: {
    sequence: number | null;
    previousHash: string | null;
    eventHash: string | null;
  };
};
export type SecretResult = { publicId: string; label: string; clientSecret: string; fingerprint: string; expiresAt: string | null };
export type MonitoringProbe = { id: number; server_id: string; code: string; hostname: string; probe_type: string; status: string; latency_ms: number | null; evidence?: Record<string, unknown>; correlation_id: string; checked_at: string };
export type OperationalAlert = {
  id: string;
  server_id: string | null;
  code: string | null;
  hostname: string | null;
  severity: "WARNING" | "HIGH" | "CRITICAL";
  alert_type: string;
  status: "OPEN" | "ACKNOWLEDGED" | "SUPPRESSED" | "CLOSED";
  title: string;
  detail: Record<string, unknown>;
  correlation_id: string;
  first_seen_at: string;
  last_seen_at: string;
  suppressed_until: string | null;
};
export type AlertDelivery = {
  id: string;
  alert_id: string;
  code: string | null;
  severity: string;
  alert_type: string;
  channel: "PRIMARY" | "BACKUP";
  idempotency_key: string;
  attempt_count: number;
  state: "PENDING" | "DELIVERED" | "RETRY" | "DEAD_LETTER";
  last_http_status: number | null;
  last_error: string | null;
  next_attempt_at: string;
  delivered_at: string | null;
  created_at: string;
};
export type ServerStateHistory = {
  id: number;
  server_id: string;
  code: string;
  registration_state: string;
  operational_state: string;
  recertification_phase: string;
  reason: string;
  correlation_id: string;
  recorded_at: string;
};
export type MonitoringOverview = {
  alerts: OperationalAlert[];
  deliveries: AlertDelivery[];
  stateHistory: ServerStateHistory[];
  scheduler: { worker_id: string; last_started_at: string; last_completed_at: string | null; last_error: string | null } | null;
};
export type AuditResponse = { events: AuditEvent[]; nextCursor: string | null };
export type AuditIntegrity = {
  valid: boolean;
  eventCount: number;
  latestEventId: number | null;
  brokenEventId: number | null;
};
export type AdminSecurity = {
  username: string;
  role: AdminRole;
  active: boolean;
  deploymentManaged: boolean;
  mfaEnabled: boolean;
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
  deploymentManaged: boolean;
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  activeSessionCount: number;
  recoveryCodeCount: number;
  current: boolean;
  role: AdminRole;
  active: boolean;
};
export type MonitoringProfile = {
  enabled: boolean;
  version: number;
  profile: {
    sloTargets: Record<string, unknown>;
    probeIntervals: Record<string, unknown>;
    alertRules: Array<Record<string, unknown>>;
    runbookRef: string;
    primaryAlertChannel: string;
    backupAlertChannel: string;
    staleAfterSeconds: number;
    retentionDays: number;
  };
};
export type OperationalConfigSetting = {
  key: string;
  envKey: string;
  label: string;
  description: string;
  kind: "string" | "number" | "boolean" | "stringList" | "secret";
  category: "network" | "security" | "runtime" | "integrations" | "observability" | "presentation";
  appliesTo: Array<"web" | "worker" | "monitor" | "egress">;
  restartRequired: boolean;
  bootstrapOnly: boolean;
  source: "database" | "default";
  value: string | number | boolean | string[] | null;
  configured: boolean;
  version: number;
  fingerprint: string;
  restartPending: boolean;
  updatedAt: string | null;
};
export const pageNames: Record<Page, string> = {
  dashboard: "Dashboard",
  generation: "Generování",
  automations: "Browser automatizace",
  registered: "Registrované prvky",
  identities: "Tokeny a identity",
  components: "Katalog komponent",
  external: "Externí strany",
  monitoring: "Monitoring komponent",
  secrets: "Správa tajemství",
  tokens: "Přístupové tokeny",
  permissions: "Správa oprávnění",
  audit: "Audit",
  config: "Konfigurace",
  security: "Bezpečnost",
  admins: "Administrátoři"
};

export const accessLabels: Record<AccessLevel, string> = {
  EXECUTE: "Spouštění"
};

export type DashboardPort = {
  key: string;
  componentId: string;
  revisionId: string;
  direction: "INCOMING" | "OUTGOING";
  kind: "PULSE";
  label: string;
  pulseType: string;
  routes: string[];
  scopes: string[];
  protocol: string;
  transport: string;
  authMode: string;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  contractDigest: string;
  source: Record<string, unknown> & { externalSources?: Array<{ publicId: string; routePattern: string; scopeName: string }> };
};
export type DashboardNode = {
  id: string;
  lifecyclePhase: "REGISTERED";
  label: string;
  componentId: string | null;
  principalId: string | null;
  code: string | null;
  displayName: string;
  description: string;
  category: string;
  role: string | null;
  lifecycleState: string;
  activationState: string;
  operationalState: string;
  monitoringState: string;
  recertificationState: string;
  enabled: boolean;
  runtimeAvailable: boolean;
  identityUnavailable: boolean;
  suspended: boolean;
  suspensionReason: string | null;
  tokenFingerprint: string | null;
  tokenLastUsedAt: string | null;
  critical: boolean;
  position: { x: number; y: number };
  secrets: Array<{ secretId: string; stableName: string; status: string; source: string }>;
  statistics: { period: string; callCount: number; successCount: number; failureCount: number; errorRate: number; lastRunAt: string | null; lastFailureAt: string | null };
};
export type DashboardConnection = {
  id: string;
  sourceComponentId: string;
  sourcePortKey: string;
  targetComponentId: string;
  targetPortKey: string;
  route: string;
  scope: string;
  audience: string;
  compatibilityStatus: "EXACT_MATCH" | "COMPATIBLE_WITH_DIFFERENCES" | "INCOMPATIBLE" | "UNKNOWN" | "STALE";
  compatibilityEvidence: Record<string, unknown>;
  authorizationDesired: boolean;
  effectiveAuthorization: "GRANTED" | "DENIED";
  authorizationReason: string;
  sourceCode: string;
  targetCode: string;
  createdAt: string;
  correlationId: string;
};
export type DashboardSecret = {
  id: string;
  stableName: string;
  displayName: string;
  description: string;
  ownerKind: string;
  ownerId: string | null;
  status: string;
  version: number | null;
  fingerprint: string | null;
  expiresAt: string | null;
  grantCount: number;
  lockVersion: number;
  deletedAt: string | null;
};
export type DashboardRuntimeEvent = {
  id: string;
  componentId: string;
  componentCode: string;
  pulseType: string | null;
  direction: string | null;
  operationKey: string;
  success: boolean;
  correlationId: string;
  traceId: string | null;
  occurredAt: string;
  receivedAt: string;
};
export type DashboardAlarm = { id: string; severity: "CRITICAL" | "HIGH"; objectId: string; title: string; impact: string; recommendedAction: string; occurredAt: string | null };
export type DashboardSecretBulkPreview = {
  secretId: string;
  stableName: string;
  secretStatus: string;
  eligibleCount: number;
  alreadyGrantedCount: number;
  createCount: number;
  eligible: Array<{ nodeId: string; label: string; alreadyGranted: boolean }>;
  skipped: Array<{ nodeId: string; label: string; reason: string }>;
};
export type DashboardDeregistrationPreview = {
  node_id: string;
  component_id: string;
  code: string;
  display_name: string;
  token_count: number;
  direct_secret_grant_count: number;
  connection_count: number;
  requiresMfa: true;
  typedConfirmation: string;
  requiresRegisteredComponent: true;
};
export type DashboardTopology = {
  generatedAt: string;
  live: { source: string; connected: boolean; lastEventAt: string | null; stale: boolean };
  workspace: { id: string; viewport: { x: number; y: number; zoom: number }; lockVersion: number };
  nodes: DashboardNode[];
  ports: DashboardPort[];
  edges: DashboardConnection[];
  secrets: DashboardSecret[];
  alarms: DashboardAlarm[];
  events: DashboardRuntimeEvent[];
};
export type DashboardIdentityCard = {
  nodeId: string;
  identityType: "COMPONENT";
  displayName: string;
  code: string | null;
  publicId: string | null;
  status: string;
  fingerprint: string | null;
  lastUsedAt: string | null;
  componentId: string | null;
};
