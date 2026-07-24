import { describe, expect, it } from "vitest";
import { validateMigrationNames } from "./migrate.js";

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
});
