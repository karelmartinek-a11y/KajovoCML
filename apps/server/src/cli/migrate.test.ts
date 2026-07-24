import { describe, expect, it } from "vitest";
import { shouldCompactAppliedSet, validateMigrationNames, type MigrationFile } from "./migrate.js";

const canonicalMigrations: MigrationFile[] = [
  { name: "001_pre_production_baseline.sql", sequence: 1, sql: "-- 001", checksum: "a".repeat(64) },
  { name: "002_secret_broker_process_role.sql", sequence: 2, sql: "-- 002", checksum: "b".repeat(64) },
  { name: "003_component_onboarding_v1_1.sql", sequence: 3, sql: "-- 003", checksum: "c".repeat(64) },
  { name: "004_dashboard_topology.sql", sequence: 4, sql: "-- 004", checksum: "d".repeat(64) },
  { name: "005_dashboard_identity_delete_guards.sql", sequence: 5, sql: "-- 005", checksum: "e".repeat(64) }
];

describe("validateMigrationNames", () => {
  it("accepts the canonical contiguous migration sequence", () => {
    expect(validateMigrationNames([
      "001_pre_production_baseline.sql",
      "002_secret_broker_process_role.sql",
      "003_component_onboarding_v1_1.sql",
      "004_dashboard_topology.sql",
      "005_dashboard_identity_delete_guards.sql"
    ])).toEqual([
      { name: "001_pre_production_baseline.sql", sequence: 1 },
      { name: "002_secret_broker_process_role.sql", sequence: 2 },
      { name: "003_component_onboarding_v1_1.sql", sequence: 3 },
      { name: "004_dashboard_topology.sql", sequence: 4 },
      { name: "005_dashboard_identity_delete_guards.sql", sequence: 5 }
    ]);
  });

  it("fails closed when a migration number is skipped", () => {
    expect(() => validateMigrationNames([
      "001_pre_production_baseline.sql",
      "002_secret_broker_process_role.sql",
      "004_dashboard_topology.sql"
    ])).toThrow("non_contiguous_migration_sequence:expected_003");
  });

  it("rejects malformed SQL migration names", () => {
    expect(() => validateMigrationNames([
      "001_pre_production_baseline.sql",
      "dashboard.sql"
    ])).toThrow("invalid_migration_filename:dashboard.sql");
  });

  it("compacts legacy ledgers that predate the baseline migration", () => {
    const applied = new Map([
      ["001_initial.sql", { sequence: null, checksum: null }]
    ]);
    expect(shouldCompactAppliedSet(canonicalMigrations, applied)).toBe(true);
  });

  it("compacts ledgers that still carry the retired dashboard migration names", () => {
    const applied = new Map([
      ["001_pre_production_baseline.sql", { sequence: 1, checksum: "a".repeat(64) }],
      ["002_secret_broker_process_role.sql", { sequence: 2, checksum: "b".repeat(64) }],
      ["003_component_onboarding_v1_1.sql", { sequence: 3, checksum: "c".repeat(64) }],
      ["004_dashboard_topology.sql", { sequence: 4, checksum: "d".repeat(64) }],
      ["005_dashboard_operational_views.sql", { sequence: 5, checksum: "legacy".repeat(10).slice(0, 64) }]
    ]);
    expect(shouldCompactAppliedSet(canonicalMigrations, applied)).toBe(true);
  });

  it("fails closed for unknown applied migrations outside the approved retired lineage", () => {
    const applied = new Map([
      ["001_pre_production_baseline.sql", { sequence: 1, checksum: "a".repeat(64) }],
      ["999_manual_hotfix.sql", { sequence: 999, checksum: "f".repeat(64) }]
    ]);
    expect(() => shouldCompactAppliedSet(canonicalMigrations, applied)).toThrow("unknown_applied_migration:999_manual_hotfix.sql");
  });
});
