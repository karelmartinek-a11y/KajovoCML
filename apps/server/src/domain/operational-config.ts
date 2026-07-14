import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit } from "./audit.js";
import { decryptMfaSecret, encryptMfaSecret, fingerprintSecret } from "../security/secrets.js";

type ConfigKind = "string" | "number" | "boolean" | "secret";

export type OperationalConfigDefinition = {
  key: string;
  envKey: keyof AppConfig;
  label: string;
  kind: ConfigKind;
  restartRequired: boolean;
  bootstrapOnly?: boolean;
};

export type OperationalConfigView = {
  key: string;
  envKey: string;
  label: string;
  kind: ConfigKind;
  restartRequired: boolean;
  bootstrapOnly: boolean;
  source: "database" | "bootstrap";
  value: string | number | boolean | null;
  fingerprint: string | null;
  updatedAt: string | null;
};

export const operationalConfigDefinitions: OperationalConfigDefinition[] = [
  { key: "publicBaseDomain", envKey: "PUBLIC_BASE_DOMAIN", label: "Veřejná base doména", kind: "string", restartRequired: true },
  { key: "adminHost", envKey: "ADMIN_HOST", label: "Admin host", kind: "string", restartRequired: true },
  { key: "authHost", envKey: "AUTH_HOST", label: "Auth host", kind: "string", restartRequired: true },
  { key: "registerHost", envKey: "REGISTER_HOST", label: "Register host", kind: "string", restartRequired: true },
  { key: "onboardingWorkerEnabled", envKey: "ONBOARDING_WORKER_ENABLED", label: "Onboarding worker zapnutý", kind: "boolean", restartRequired: true },
  { key: "onboardingWorkerIntervalMs", envKey: "ONBOARDING_WORKER_INTERVAL_MS", label: "Interval workeru", kind: "number", restartRequired: true },
  { key: "quarantineRoot", envKey: "QUARANTINE_ROOT", label: "Karanténní adresář", kind: "string", restartRequired: true },
  { key: "runtimeSocketRoot", envKey: "RUNTIME_SOCKET_ROOT", label: "Runtime socket root", kind: "string", restartRequired: true },
  { key: "egressProxySocketPath", envKey: "EGRESS_PROXY_SOCKET_PATH", label: "Egress proxy socket", kind: "string", restartRequired: true },
  { key: "wildcardTlsCertPath", envKey: "WILDCARD_TLS_CERT_PATH", label: "Wildcard TLS certifikát", kind: "string", restartRequired: true },
  { key: "logLevel", envKey: "LOG_LEVEL", label: "Log level", kind: "string", restartRequired: true },
  { key: "githubOwner", envKey: "GITHUB_OWNER", label: "GitHub owner", kind: "string", restartRequired: true },
  { key: "githubRepo", envKey: "GITHUB_REPO", label: "GitHub repo", kind: "string", restartRequired: true },
  { key: "githubToken", envKey: "GITHUB_TOKEN", label: "GitHub token", kind: "secret", restartRequired: true },
  { key: "githubAppId", envKey: "GITHUB_APP_ID", label: "GitHub App ID", kind: "string", restartRequired: true },
  { key: "githubAppInstallationId", envKey: "GITHUB_APP_INSTALLATION_ID", label: "GitHub App installation ID", kind: "string", restartRequired: true },
  { key: "githubAppPrivateKey", envKey: "GITHUB_APP_PRIVATE_KEY_BASE64", label: "GitHub App private key", kind: "secret", restartRequired: true },
  { key: "ociRegistry", envKey: "OCI_REGISTRY", label: "OCI registry", kind: "string", restartRequired: true },
  { key: "ociImageNamespace", envKey: "OCI_IMAGE_NAMESPACE", label: "OCI image namespace", kind: "string", restartRequired: true },
  { key: "ociSigningPublicKey", envKey: "OCI_SIGNING_PUBLIC_KEY", label: "OCI signing public key", kind: "string", restartRequired: true },
  { key: "podmanBinary", envKey: "PODMAN_BINARY", label: "Podman binary", kind: "string", restartRequired: true },
  { key: "cosignBinary", envKey: "COSIGN_BINARY", label: "Cosign binary", kind: "string", restartRequired: true },
  { key: "accessTokenHmacKey", envKey: "ACCESS_TOKEN_HMAC_KEY_BASE64", label: "Access token HMAC key", kind: "secret", restartRequired: true },
  { key: "accessTokenHmacKeyId", envKey: "ACCESS_TOKEN_HMAC_KEY_ID", label: "Access token key ID", kind: "string", restartRequired: true },
  { key: "integrationTokenHmacKey", envKey: "INTEGRATION_TOKEN_HMAC_KEY_BASE64", label: "Integration token HMAC key", kind: "secret", restartRequired: true },
  { key: "integrationTokenHmacKeyId", envKey: "INTEGRATION_TOKEN_HMAC_KEY_ID", label: "Integration token key ID", kind: "string", restartRequired: true },
  { key: "egressCapabilityHmacKey", envKey: "EGRESS_CAPABILITY_HMAC_KEY_BASE64", label: "Egress capability HMAC key", kind: "secret", restartRequired: true },
  { key: "sessionSecret", envKey: "SESSION_SECRET_BASE64", label: "Session secret", kind: "secret", restartRequired: true },
  { key: "csrfSecret", envKey: "CSRF_SECRET_BASE64", label: "CSRF secret", kind: "secret", restartRequired: true },
  { key: "mfaEncryptionKey", envKey: "MFA_ENCRYPTION_KEY_BASE64", label: "MFA encryption key", kind: "secret", restartRequired: true, bootstrapOnly: true },
  { key: "databaseUrl", envKey: "DATABASE_URL", label: "Database URL", kind: "secret", restartRequired: true, bootstrapOnly: true }
];

function envValue(config: AppConfig, definition: OperationalConfigDefinition): string | number | boolean | null {
  const value = config[definition.envKey];
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (typeof value === "undefined") return null;
  return value;
}

function configAsEnv(config: AppConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const definition of operationalConfigDefinitions) {
    const value = envValue(config, definition);
    if (value !== null) env[String(definition.envKey)] = String(value);
  }
  env.NODE_ENV = config.NODE_ENV;
  env.PORT = String(config.PORT);
  env.ADMIN_BOOTSTRAP_USERNAME = config.ADMIN_BOOTSTRAP_USERNAME;
  if (config.ADMIN_TOTP_SECRET) env.ADMIN_TOTP_SECRET = config.ADMIN_TOTP_SECRET;
  return env;
}

function encodeForEnv(definition: OperationalConfigDefinition, value: unknown): string {
  if (definition.kind === "boolean") return value === true || value === "true" ? "true" : "false";
  if (definition.kind === "number") return String(Number(value));
  return String(value);
}

export async function loadConfigFromDb(db: Db, bootstrapConfig: AppConfig): Promise<AppConfig> {
  let rows: Array<{ key: unknown; value_json: unknown; value_ciphertext: unknown }>;
  try {
    const result = await db.query("select key, value_json, value_ciphertext from operational_config_setting");
    rows = result.rows;
  } catch (error) {
    if (String((error as { code?: unknown }).code) === "42P01") return bootstrapConfig;
    throw error;
  }
  const overlay: Record<string, string> = {};
  for (const row of rows) {
    const definition = operationalConfigDefinitions.find((item) => item.key === row.key);
    if (!definition || definition.bootstrapOnly) continue;
    const ciphertext = typeof row.value_ciphertext === "string" ? row.value_ciphertext : "";
    const value = ciphertext
      ? decryptMfaSecret(ciphertext, bootstrapConfig.MFA_ENCRYPTION_KEY_BASE64)
      : row.value_json;
    overlay[String(definition.envKey)] = encodeForEnv(definition, value);
  }
  return loadConfig({ ...configAsEnv(bootstrapConfig), ...overlay });
}

export async function listOperationalConfig(db: Db, config: AppConfig): Promise<OperationalConfigView[]> {
  const result = await db.query("select key, value_json, value_ciphertext, updated_at from operational_config_setting");
  const rows = new Map(result.rows.map((row) => [String(row.key), row]));
  return operationalConfigDefinitions.map((definition) => {
    const row = rows.get(definition.key);
    const source = row ? "database" : "bootstrap";
    const rawValue = row?.value_ciphertext
      ? decryptMfaSecret(String(row.value_ciphertext), config.MFA_ENCRYPTION_KEY_BASE64)
      : row?.value_json ?? envValue(config, definition);
    return {
      key: definition.key,
      envKey: String(definition.envKey),
      label: definition.label,
      kind: definition.kind,
      restartRequired: definition.restartRequired,
      bootstrapOnly: Boolean(definition.bootstrapOnly),
      source,
      value: definition.kind === "secret" ? null : rawValue as string | number | boolean | null,
      fingerprint: definition.kind === "secret" && rawValue ? fingerprintSecret(String(rawValue)) : null,
      updatedAt: row?.updated_at ? String(row.updated_at) : null
    };
  });
}

export async function updateOperationalConfig(
  db: Db,
  config: AppConfig,
  actorId: string,
  correlationId: string,
  key: string,
  value: unknown
): Promise<void> {
  const definition = operationalConfigDefinitions.find((item) => item.key === key);
  if (!definition) throw Object.assign(new Error("config_key_not_found"), { statusCode: 404 });
  if (definition.bootstrapOnly) throw Object.assign(new Error("config_bootstrap_only"), { statusCode: 409 });
  if (definition.kind === "number" && !Number.isFinite(Number(value))) {
    throw Object.assign(new Error("config_invalid_number"), { statusCode: 400 });
  }
  const storedValue = definition.kind === "number"
    ? Number(value)
    : definition.kind === "boolean"
      ? value === true || value === "true"
      : String(value);
  await tx(db, async (client) => {
    await client.query(
      `insert into operational_config_setting(key, value_json, value_ciphertext, updated_by)
       values ($1,$2,$3,$4)
       on conflict (key) do update
         set value_json=excluded.value_json,
             value_ciphertext=excluded.value_ciphertext,
             updated_by=excluded.updated_by,
             updated_at=now()`,
      [
        definition.key,
        definition.kind === "secret" ? null : storedValue,
        definition.kind === "secret" ? encryptMfaSecret(String(value), config.MFA_ENCRYPTION_KEY_BASE64) : null,
        actorId
      ]
    );
    await appendAudit(client, {
      eventType: "operational_config.updated",
      actorType: "admin",
      actorId,
      objectType: "operational_config",
      objectId: definition.key,
      after: {
        envKey: definition.envKey,
        kind: definition.kind,
        restartRequired: definition.restartRequired,
        value: definition.kind === "secret" ? "[REDACTED]" : storedValue
      },
      correlationId
    });
  });
}
