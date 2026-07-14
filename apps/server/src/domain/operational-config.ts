import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { tx } from "../db.js";
import { appendAudit } from "./audit.js";

type ConfigKind = "string" | "number";
type EditableEnvKey = "ONBOARDING_WORKER_INTERVAL_MS" | "MONITOR_INTERVAL_MS" | "LOG_LEVEL";

export type OperationalConfigDefinition = {
  key: string;
  envKey: EditableEnvKey;
  label: string;
  kind: ConfigKind;
  restartRequired: boolean;
};

export type OperationalConfigView = {
  key: string;
  envKey: string;
  label: string;
  kind: ConfigKind;
  restartRequired: boolean;
  bootstrapOnly: false;
  source: "database" | "bootstrap";
  value: string | number;
  fingerprint: null;
  updatedAt: string | null;
};

export const operationalConfigDefinitions: OperationalConfigDefinition[] = [
  { key: "onboardingWorkerIntervalMs", envKey: "ONBOARDING_WORKER_INTERVAL_MS", label: "Interval onboarding workeru", kind: "number", restartRequired: true },
  { key: "monitorIntervalMs", envKey: "MONITOR_INTERVAL_MS", label: "Interval monitoru", kind: "number", restartRequired: true },
  { key: "logLevel", envKey: "LOG_LEVEL", label: "Úroveň logování", kind: "string", restartRequired: true }
];

function bootstrapValue(config: AppConfig, definition: OperationalConfigDefinition): string | number {
  return config[definition.envKey];
}

function parseValue(definition: OperationalConfigDefinition, value: unknown): string | number {
  if (definition.kind === "number") {
    const parsed = Number(value);
    const minimum = definition.envKey === "MONITOR_INTERVAL_MS" ? 15_000 : 1_000;
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > 900_000) {
      throw Object.assign(new Error("config_invalid_interval"), { statusCode: 400 });
    }
    return parsed;
  }
  const parsed = String(value).trim().toLowerCase();
  if (!["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(parsed)) {
    throw Object.assign(new Error("config_invalid_log_level"), { statusCode: 400 });
  }
  return parsed;
}

export async function loadConfigFromDb(db: Db, bootstrapConfig: AppConfig): Promise<AppConfig> {
  let rows: Array<{ key: unknown; value_json: unknown }>;
  try {
    const result = await db.query("select key, value_json from operational_config_setting");
    rows = result.rows;
  } catch (error) {
    if (String((error as { code?: unknown }).code) === "42P01") return bootstrapConfig;
    throw error;
  }

  const merged: AppConfig = { ...bootstrapConfig };
  for (const row of rows) {
    const definition = operationalConfigDefinitions.find((item) => item.key === row.key);
    if (!definition) continue;
    const value = parseValue(definition, row.value_json);
    if (definition.envKey === "ONBOARDING_WORKER_INTERVAL_MS") merged.ONBOARDING_WORKER_INTERVAL_MS = Number(value);
    else if (definition.envKey === "MONITOR_INTERVAL_MS") merged.MONITOR_INTERVAL_MS = Number(value);
    else merged.LOG_LEVEL = String(value);
  }
  return merged;
}

export async function listOperationalConfig(db: Db, config: AppConfig): Promise<OperationalConfigView[]> {
  const result = await db.query("select key, value_json, updated_at from operational_config_setting");
  const rows = new Map(result.rows.map((row) => [String(row.key), row]));
  return operationalConfigDefinitions.map((definition) => {
    const row = rows.get(definition.key);
    return {
      key: definition.key,
      envKey: definition.envKey,
      label: definition.label,
      kind: definition.kind,
      restartRequired: definition.restartRequired,
      bootstrapOnly: false,
      source: row ? "database" : "bootstrap",
      value: row ? parseValue(definition, row.value_json) : bootstrapValue(config, definition),
      fingerprint: null,
      updatedAt: row?.updated_at ? String(row.updated_at) : null
    };
  });
}

export async function updateOperationalConfig(
  db: Db,
  actorId: string,
  correlationId: string,
  key: string,
  value: unknown
): Promise<void> {
  const definition = operationalConfigDefinitions.find((item) => item.key === key);
  if (!definition) throw Object.assign(new Error("config_key_not_found"), { statusCode: 404 });
  const storedValue = parseValue(definition, value);

  await tx(db, async (client) => {
    await client.query(
      `insert into operational_config_setting(key, value_json, updated_by)
       values ($1,$2,$3)
       on conflict (key) do update
         set value_json=excluded.value_json,
             updated_by=excluded.updated_by,
             updated_at=now()`,
      [definition.key, storedValue, actorId]
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
        value: storedValue
      },
      correlationId
    });
  });
}
