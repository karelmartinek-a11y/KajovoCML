import argon2 from "argon2";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import {
  forensicAdminPasswordVariants,
  requireDeploymentManagedAdminPassword
} from "../domain/deployment-managed-admin.js";
import { loadConfigFromDb } from "../domain/operational-config.js";

type CredentialRow = {
  id: string;
  password_hash: string | null;
  password_changed_at: Date | string | null;
  mfa_enabled: boolean;
  mfa_secret: string | null;
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

async function passwordMatches(hash: string | null, password: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

async function matchingVariantLabels(hash: string | null, rawPassword: string): Promise<string[]> {
  const labels: string[] = [];
  for (const variant of forensicAdminPasswordVariants(rawPassword)) {
    if (await passwordMatches(hash, variant.value)) labels.push(variant.label);
  }
  return labels;
}

const bootstrap = loadBootstrapConfig();
const db = createDb(bootstrap);

try {
  const config = await loadConfigFromDb(db, bootstrap);
  const rawPassword = process.env.PASS;
  const password = requireDeploymentManagedAdminPassword(rawPassword);
  const current = await db.query<CredentialRow>(
    `select id,password_hash,password_changed_at,mfa_enabled,mfa_secret
       from public.admin_account
      where username=$1`,
    [config.ADMIN_BOOTSTRAP_USERNAME]
  );
  const archiveTables = await db.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema='factory_reset_archive'
        and table_name like 'admin_account__%'
      order by table_name`
  );

  const observations: Array<Record<string, unknown>> = [];
  for (const row of current.rows) {
    observations.push({
      source: "current",
      passwordMatchesPass: await passwordMatches(row.password_hash, password),
      passwordMatchesRawPass: await passwordMatches(row.password_hash, rawPassword ?? ""),
      matchingRawPassVariants: await matchingVariantLabels(row.password_hash, rawPassword ?? ""),
      passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at).toISOString() : null,
      mfaEnabled: Boolean(row.mfa_enabled),
      mfaSecretPresent: Boolean(row.mfa_secret)
    });
  }
  for (const { table_name: tableName } of archiveTables.rows) {
    if (!/^admin_account__[a-f0-9_]+$/u.test(tableName)) continue;
    const archived = await db.query<CredentialRow>(
      `select id,password_hash,password_changed_at,mfa_enabled,mfa_secret
         from factory_reset_archive.${quoteIdentifier(tableName)}
        where username=$1`,
      [config.ADMIN_BOOTSTRAP_USERNAME]
    );
    for (const row of archived.rows) {
      observations.push({
        source: tableName,
        passwordMatchesPass: await passwordMatches(row.password_hash, password),
        passwordMatchesRawPass: await passwordMatches(row.password_hash, rawPassword ?? ""),
        matchingRawPassVariants: await matchingVariantLabels(row.password_hash, rawPassword ?? ""),
        passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at).toISOString() : null,
        mfaEnabled: Boolean(row.mfa_enabled),
        mfaSecretPresent: Boolean(row.mfa_secret)
      });
    }
  }

  const currentMatches = observations.some((item) => item.source === "current" && item.passwordMatchesPass === true);
  const currentHasPasswordHash = current.rowCount === 1 && typeof current.rows[0]?.password_hash === "string";
  process.stdout.write(`${JSON.stringify({
    username: config.ADMIN_BOOTSTRAP_USERNAME,
    currentAccountCount: current.rowCount,
    currentMatchesPass: currentMatches,
    currentHasPasswordHash,
    observations
  })}\n`);
  if (current.rowCount !== 1 || !currentHasPasswordHash) throw new Error("deployment_managed_admin_current_credential_missing");
} finally {
  await db.end();
}
