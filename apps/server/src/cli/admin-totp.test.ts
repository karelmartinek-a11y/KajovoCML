import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptMfaSecret } from "../security/secrets.js";
import { resolveAdminTotpSecret } from "./admin-totp.js";

const key = Buffer.alloc(32, 7);
const baseConfig = {
  ADMIN_BOOTSTRAP_USERNAME: "karmar78",
  ADMIN_TOTP_SECRET: undefined,
  MFA_ENCRYPTION_KEY_BASE64: key,
  MFA_ALLOW_PLAINTEXT_LEGACY: false
} as const;

function database(rows: Array<Record<string, unknown>>) {
  return { query: vi.fn(async () => ({ rowCount: rows.length, rows })) } as never;
}

describe("canonical deployment MFA resolution", () => {
  it("uses the enrolled OWNER database record when no env TOTP is available", async () => {
    const accountId = randomUUID();
    const encrypted = encryptMfaSecret("synthetic-owner-totp", key, { subjectId: accountId, purpose: "admin_totp" });
    const resolved = await resolveAdminTotpSecret(database([{ id: accountId, mfa_enabled: true, mfa_secret: encrypted }]), baseConfig);
    expect(resolved).toBe("synthetic-owner-totp");
  });

  it("does not let a deployment fallback override enrolled database MFA", async () => {
    const accountId = randomUUID();
    const encrypted = encryptMfaSecret("database-owner-totp", key, { subjectId: accountId, purpose: "admin_totp" });
    const resolved = await resolveAdminTotpSecret(database([{ id: accountId, mfa_enabled: true, mfa_secret: encrypted }]), {
      ...baseConfig,
      ADMIN_TOTP_SECRET: "synthetic-fallback-totp"
    });
    expect(resolved).toBe("database-owner-totp");
  });

  it("uses the explicit fallback only when the OWNER account is not enrolled", async () => {
    const resolved = await resolveAdminTotpSecret(database([{ id: randomUUID(), mfa_enabled: false, mfa_secret: null }]), {
      ...baseConfig,
      ADMIN_TOTP_SECRET: "synthetic-fallback-totp"
    });
    expect(resolved).toBe("synthetic-fallback-totp");
  });
});
