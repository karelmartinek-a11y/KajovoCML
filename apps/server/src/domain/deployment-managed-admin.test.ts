import type pg from "pg";
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalAdminPassword,
  forensicAdminPasswordVariants,
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

  it("labels forensic variants without returning duplicates or the original value", () => {
    const variants = forensicAdminPasswordVariants("\uFEFFheslo\u00A0\r\n");
    expect(variants.map(({ label }) => label)).toEqual(expect.arrayContaining([
      "canonical-line-endings",
      "trim",
      "trim-start",
      "unicode-nfkc",
      "normalize-internal-line-endings"
    ]));
    expect(variants.every(({ value }) => value !== "\uFEFFheslo\u00A0\r\n")).toBe(true);
    expect(new Set(variants.map(({ value }) => value)).size).toBe(variants.length);
  });

  it("preserves enrolled MFA when deployment has no configured TOTP secret", async () => {
    const accountId = randomUUID();
    const encryptedMfaSecret = "enc:v1:existing-secret";
    const passwordHash = await argon2.hash("deployment-password");
    const sessionEpoch = randomUUID();
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (sql.startsWith("select id,password_hash,mfa_enabled,mfa_secret,session_epoch")) {
        return {
          rowCount: 1,
          rows: [{ id: accountId, password_hash: passwordHash, mfa_enabled: true, mfa_secret: encryptedMfaSecret, session_epoch: sessionEpoch }]
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
    expect(query.mock.calls.some(([sql]) => sql.startsWith("update admin_session"))).toBe(false);
    expect(result).toMatchObject({
      accountId,
      mfaEnabled: true,
      mfaSource: "preserved",
      passwordMatchesInput: true,
      passwordSource: "existing",
      sessionEpoch
    });
  });

  it("preserves a working owner credential instead of overwriting a PASS divergence", async () => {
    const accountId = randomUUID();
    const passwordHash = await argon2.hash("working-owner-password");
    const sessionEpoch = randomUUID();
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      void _params;
      if (sql.startsWith("select id,password_hash,mfa_enabled,mfa_secret,session_epoch")) {
        return {
          rowCount: 1,
          rows: [{ id: accountId, password_hash: passwordHash, mfa_enabled: false, mfa_secret: null, session_epoch: sessionEpoch }]
        };
      }
      return { rowCount: 1, rows: [] };
    });

    const result = await syncDeploymentManagedAdmin({ query } as unknown as pg.PoolClient, {
      username: "karmar78",
      password: "divergent-deployment-pass",
      mfaEncryptionKey: Buffer.alloc(32),
      actorType: "deployment",
      eventType: "admin.password.reconciled",
      correlationId: randomUUID()
    });

    const accountUpdate = query.mock.calls.find(([sql]) => sql.includes("set password_hash=$2"));
    expect(accountUpdate?.[1]?.[1]).toBe(passwordHash);
    expect(accountUpdate?.[1]?.[5]).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("update admin_session"))).toBe(false);
    expect(result).toMatchObject({
      passwordMatchesInput: false,
      passwordSource: "existing",
      sessionEpoch
    });
  });
});
