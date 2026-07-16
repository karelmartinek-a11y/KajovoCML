import { describe, expect, it, vi } from "vitest";
import { loadBootstrapConfig, loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { encryptVaultSecret } from "../security/secrets.js";
import { listOperationalConfig, loadConfigFromDb, updateDomainConfiguration, updateOperationalConfig } from "./operational-config.js";

const vaultKey = Buffer.alloc(32, 91);

function bootstrap() {
  return loadBootstrapConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused/test",
    CONFIG_VAULT_MASTER_KEY_BASE64: vaultKey.toString("base64"),
    CONFIG_VAULT_MASTER_KEY_ID: "vault-test"
  });
}

function legacyConfig() {
  const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused/test",
    CONFIG_VAULT_MASTER_KEY_BASE64: vaultKey.toString("base64"),
    CONFIG_VAULT_MASTER_KEY_ID: "vault-test",
    ACCESS_TOKEN_HMAC_KEY_BASE64: secret(1),
    INTEGRATION_TOKEN_HMAC_KEY_BASE64: secret(2),
    EGRESS_CAPABILITY_HMAC_KEY_BASE64: secret(3),
    SESSION_SECRET_BASE64: secret(4),
    CSRF_SECRET_BASE64: secret(5),
    MFA_ENCRYPTION_KEY_BASE64: secret(6)
  });
}

describe("operational configuration registry", () => {
  it("uses a DB value in the effective runtime configuration", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("select key,value_json")) {
        return { rowCount: 2, rows: [
          { key: "monitorIntervalMs", value_json: 30_000, secret_ciphertext: null, is_secret: false, version: 2 },
          { key: "uiTimeZone", value_json: "UTC", secret_ciphertext: null, is_secret: false, version: 1 }
        ] };
      }
      return { rowCount: 1, rows: [] };
    });
    const db = { query } as unknown as Db;
    const effective = await loadConfigFromDb(db, bootstrap());
    expect(effective.MONITOR_INTERVAL_MS).toBe(30_000);
    expect(effective.UI_TIME_ZONE).toBe("UTC");
  });

  it("never exposes plaintext secrets in the admin view", async () => {
    const ciphertext = encryptVaultSecret("plaintext-must-not-leak", vaultKey, { keyId: "vault-test", settingKey: "githubToken" });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from operational_config_setting")) return { rowCount: 1, rows: [{ key: "githubToken", value_json: null, secret_ciphertext: ciphertext, is_secret: true, version: 3 }] };
      if (sql.includes("from operational_config_applied")) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const settings = await listOperationalConfig({ query } as unknown as Db, legacyConfig());
    expect(settings.find((setting) => setting.key === "githubToken")).toMatchObject({ value: null, configured: true, version: 3 });
    expect(JSON.stringify(settings)).not.toContain("plaintext-must-not-leak");
  });

  it("stores a secret only as AEAD ciphertext and audits fingerprints", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("from operational_config_setting") && sql.includes("for update")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    const client = { query, release: vi.fn() };
    const db = { query, connect: vi.fn(async () => client) } as unknown as Db;
    const plaintext = "github-token-with-sufficient-length";
    await updateOperationalConfig(db, legacyConfig(), "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "githubToken", plaintext, 0);
    const insert = calls.find((call) => call.sql.includes("insert into operational_config_setting"));
    expect(insert?.params?.[1]).toBeNull();
    expect(String(insert?.params?.[2])).toMatch(/^vault:v1:/);
    expect(JSON.stringify(calls)).not.toContain(plaintext);
  });

  it("migrates the base domain, hostnames, epochs and token validity in one transaction", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes("from operational_config_setting") && sql.includes("for update")) {
        return { rowCount: 4, rows: [
          { key: "publicBaseDomain", value_json: "old.example", version: 2 },
          { key: "adminHost", value_json: "admin.old.example", version: 1 },
          { key: "authHost", value_json: "auth.old.example", version: 1 },
          { key: "registerHost", value_json: "register.old.example", version: 1 }
        ] };
      }
      if (sql.includes("update mcp_server")) return { rowCount: 2, rows: [{ id: "server-1" }, { id: "server-2" }] };
      return { rowCount: 1, rows: [] };
    });
    const client = { query, release: vi.fn() };
    const db = { connect: vi.fn(async () => client) } as unknown as Db;

    await expect(updateDomainConfiguration(db, "admin", "00000000-0000-4000-8000-000000000003", "New.Example.Test.", {
      publicBaseDomain: 2,
      adminHost: 1,
      authHost: 1,
      registerHost: 1
    })).resolves.toEqual({ baseDomain: "new.example.test", migratedServers: 2 });

    expect(calls.filter((call) => call.sql.includes("insert into operational_config_setting"))).toHaveLength(4);
    expect(calls.find((call) => call.sql.includes("insert into operational_config_setting") && call.params?.[0] === "publicBaseDomain")?.params?.[1])
      .toBe(JSON.stringify("new.example.test"));
    expect(calls.some((call) => call.sql.includes("update access_token set revoked_at"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("update managed_service_access_token"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("append_audit_event"))).toBe(true);
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("rolls back a domain plan when any optimistic version is stale", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes("from operational_config_setting") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ key: "publicBaseDomain", value_json: "old.example", version: 3 }] };
      }
      throw new Error("unexpected_mutation");
    });
    const client = { query, release: vi.fn() };
    const db = { connect: vi.fn(async () => client) } as unknown as Db;
    await expect(updateDomainConfiguration(db, "admin", "00000000-0000-4000-8000-000000000004", "new.example", {
      publicBaseDomain: 2,
      adminHost: 0,
      authHost: 0,
      registerHost: 0
    })).rejects.toMatchObject({ message: "config_version_conflict", statusCode: 409 });
    expect(query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
  });
});
