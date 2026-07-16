import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";

const MIGRATION_NAME = /^(\d{3})_([a-z0-9_]+)[.]sql$/;
const FIRST_LEDGER_MIGRATION = 7;
const LEGACY_MIGRATIONS = new Set([
  "001_initial.sql",
  "002_kaja_labels.sql",
  "003_kaja_lifecycle_permissions.sql",
  "004_permission_access_level.sql",
  "005_automated_onboarding.sql",
  "005_fix_mcp_hostname_constraint.sql",
  "006_invocation_latency_metrics.sql"
]);
const SUPERSEDED_PRE_LEDGER_MIGRATIONS = new Set([
  "007_auth_hardening.sql",
  "008_mcp_runtime_policies.sql",
  "009_permission_and_tool_scope.sql",
  "010_audit_hash_chain.sql",
  "011_admin_bootstrap_recovery.sql",
  "011_integration_token_descriptor.sql",
  "012_operational_config.sql",
  "013_rate_bucket_per_client.sql",
  "014_mcp_idempotency.sql"
]);

export type MigrationFile = {
  name: string;
  sequence: number;
  sql: string;
  checksum: string;
};

export function validateMigrationNames(entries: string[]): Array<{ name: string; sequence: number }> {
  const candidates = entries.filter((entry) => !entry.startsWith("._") && entry.endsWith(".sql"));
  const parsed = candidates.map((name) => {
    const match = MIGRATION_NAME.exec(name);
    if (!match) throw new Error(`invalid_migration_filename:${name}`);
    return { name, sequence: Number(match[1]) };
  }).sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));

  const future = parsed.filter((migration) => migration.sequence >= FIRST_LEDGER_MIGRATION);
  for (let index = 0; index < future.length; index += 1) {
    const expected = FIRST_LEDGER_MIGRATION + index;
    if (future[index]?.sequence !== expected) {
      throw new Error(`non_contiguous_migration_sequence:expected_${String(expected).padStart(3, "0")}`);
    }
  }
  return parsed;
}

async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const parsed = validateMigrationNames(await fs.readdir(directory));
  return Promise.all(parsed.map(async ({ name, sequence }) => {
    const sql = await fs.readFile(path.join(directory, name), "utf8");
    return {
      name,
      sequence,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    };
  }));
}

async function ledgerHasChecksums(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query(
    `select count(*)::int as count
       from information_schema.columns
      where table_schema=current_schema()
        and table_name='schema_migration'
        and column_name in ('sequence_number','checksum_sha256')`
  );
  return Number(result.rows[0]?.count ?? 0) === 2;
}

async function appliedMigrations(client: pg.PoolClient, checksummed: boolean): Promise<Map<string, { sequence: number | null; checksum: string | null }>> {
  const result = checksummed
    ? await client.query("select version,sequence_number,checksum_sha256 from schema_migration")
    : await client.query("select version,null::integer as sequence_number,null::text as checksum_sha256 from schema_migration");
  return new Map(result.rows.map((row) => [String(row.version), {
    sequence: row.sequence_number === null ? null : Number(row.sequence_number),
    checksum: row.checksum_sha256 === null ? null : String(row.checksum_sha256)
  }]));
}

function validateAppliedSet(migrations: MigrationFile[], applied: Map<string, { sequence: number | null; checksum: string | null }>, checksummed: boolean): void {
  const available = new Map(migrations.map((migration) => [migration.name, migration]));
  for (const [version, entry] of applied) {
    if (!checksummed && SUPERSEDED_PRE_LEDGER_MIGRATIONS.has(version)) continue;
    const migration = available.get(version);
    if (!migration) {
      throw new Error(`unknown_applied_migration:${version}`);
    }
    if (!checksummed) {
      if (!LEGACY_MIGRATIONS.has(version)) throw new Error(`migration_ledger_missing_for:${version}`);
      continue;
    }
    if (entry.sequence !== migration.sequence) throw new Error(`migration_sequence_changed:${version}`);
    if (!entry.checksum) throw new Error(`migration_checksum_missing:${version}`);
    if (entry.checksum !== migration.checksum) throw new Error(`migration_checksum_changed:${version}`);
  }

  const highestApplied = Math.max(
    FIRST_LEDGER_MIGRATION - 1,
    ...Array.from(applied.entries())
      .filter(([, entry]) => (entry.sequence ?? 0) >= FIRST_LEDGER_MIGRATION)
      .map(([, entry]) => entry.sequence ?? 0)
  );
  for (const migration of migrations) {
    if (migration.sequence >= FIRST_LEDGER_MIGRATION && migration.sequence < highestApplied && !applied.has(migration.name)) {
      throw new Error(`late_inserted_migration:${migration.name}`);
    }
  }
}

async function backfillLegacyChecksums(client: pg.PoolClient, migrations: MigrationFile[], applied: Map<string, { sequence: number | null; checksum: string | null }>): Promise<void> {
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));
  for (const version of applied.keys()) {
    const migration = byName.get(version);
    if (!migration) throw new Error(`unknown_applied_migration:${version}`);
    await client.query(
      `update schema_migration
          set sequence_number=$2,
              checksum_sha256=$3
        where version=$1`,
      [version, migration.sequence, migration.checksum]
    );
  }
}

export async function runMigrations(): Promise<void> {
  const config = loadBootstrapConfig();
  const db = createDb(config);
  const client = await db.connect();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const directory = path.resolve(currentDir, "../migrations");
  const migrations = await loadMigrations(directory);

  try {
    await client.query("select pg_advisory_lock(hashtextextended('kcml-schema-migrations', 0))");
    await client.query("create table if not exists schema_migration(version text primary key, applied_at timestamptz not null default now())");
    let checksummed = await ledgerHasChecksums(client);
    let applied = await appliedMigrations(client, checksummed);
    validateAppliedSet(migrations, applied, checksummed);

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      await client.query("begin");
      try {
        await client.query("set local lock_timeout='10s'");
        await client.query("set local statement_timeout='5min'");
        await client.query(migration.sql);
        checksummed = await ledgerHasChecksums(client);
        if (migration.sequence === FIRST_LEDGER_MIGRATION) {
          if (!checksummed) throw new Error("migration_ledger_columns_missing");
          applied = await appliedMigrations(client, checksummed);
          await backfillLegacyChecksums(client, migrations, applied);
        }
        if (checksummed) {
          await client.query(
            "insert into schema_migration(version,sequence_number,checksum_sha256) values ($1,$2,$3)",
            [migration.name, migration.sequence, migration.checksum]
          );
        } else {
          await client.query("insert into schema_migration(version) values ($1)", [migration.name]);
        }
        await client.query("commit");
        applied.set(migration.name, { sequence: migration.sequence, checksum: checksummed ? migration.checksum : null });
        process.stderr.write(`Applied migration ${migration.name}\n`);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }

    checksummed = await ledgerHasChecksums(client);
    applied = await appliedMigrations(client, checksummed);
    validateAppliedSet(migrations, applied, checksummed);
  } finally {
    await client.query("select pg_advisory_unlock(hashtextextended('kcml-schema-migrations', 0))").catch(() => undefined);
    client.release();
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrations();
}
