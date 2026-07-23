import type pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalAdminPassword,
  requireDeploymentManagedAdminPassword,
  syncDeploymentManagedAdmin
} from "./deployment-managed-admin.js";

describe("deployment managed admin password handling", () => {
  it("removes only trailing CRLF characters", () => {
    expect(canonicalAdminPassword("secret\r\n")).toBe("secret");
    expect(canonicalAdminPassword("secret\n\r")).toBe("secret");
    expect(canonicalAdminPassword("se\ncret")).toBe("se\ncret");
  });

  it("rejects empty PASS after canonicalization", () => {
    expect(() => requireDeploymentManagedAdminPassword(undefined)).toThrow("PASS must not be empty");
    expect(() => requireDeploymentManagedAdminPassword("\r\n")).toThrow("PASS must not be empty after removing trailing line endings");
  });

  it("preserves enrolled MFA when deployment has no configured TOTP secret", async () => {
    const accountId = randomUUID();
    const encryptedMfaSecret = "enc:v1:existing-secret";
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (sql.startsWith("select id,mfa_enabled,mfa_secret")) {
        return {
          rowCount: 1,
          rows: [{ id: accountId, mfa_enabled: true, mfa_secret: encryptedMfaSecret }]
        };
      }
      return { rowCount: 1, rows: [] };
    });
    const client = { query } as unknown as pg.PoolClient;

    const result = await syncDeploymentManagedAdmin(client, {
      username: "karmar78",
      password: "deployment-password",
      mfaEncryptionKey: Buffer.alloc(32),
      actorType: "deployment",
      eventType: "admin.password.synced",
      correlationId: randomUUID()
    });

    const accountUpdate = query.mock.calls.find(([sql]) => sql.includes("set password_hash=$2"));
    expect(accountUpdate?.[1]?.[2]).toBe(true);
    expect(accountUpdate?.[1]?.[3]).toBe(encryptedMfaSecret);
    expect(result).toMatchObject({ accountId, mfaEnabled: true, mfaSource: "preserved" });
  });
});
