import { describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret, issueOpaqueSecret, SECRET_BYTES, fingerprintSecret, hmacToken, redact } from "./secrets.js";

describe("KCML secrets", () => {
  it("issues client and bearer secrets from at least 64 random bytes", () => {
    const issued = issueOpaqueSecret();
    const decoded = Buffer.from(issued.value, "base64url");
    expect(decoded.length).toBe(SECRET_BYTES);
    expect(issued.value).not.toContain("=");
    expect(issued.fingerprint).toHaveLength(32);
  });

  it("uses keyed lookup digests and non-verifying fingerprints", () => {
    const key = Buffer.alloc(32, 7);
    const digestA = hmacToken("token-a", key);
    const digestB = hmacToken("token-b", key);
    expect(digestA.equals(digestB)).toBe(false);
    expect(fingerprintSecret("token-a")).not.toEqual(digestA.toString("hex"));
  });

  it("encrypts MFA secrets and keeps enc:v1 ciphertext readable", () => {
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP", key);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptMfaSecret(encrypted, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rejects plaintext MFA secrets unless an explicit legacy mode is enabled", () => {
    const key = Buffer.alloc(32, 9);
    expect(() => decryptMfaSecret("JBSWY3DPEHPK3PXP", key)).toThrow(/plaintext_mfa_secret_rejected/);
    expect(decryptMfaSecret("JBSWY3DPEHPK3PXP", key, { allowLegacyPlaintext: true })).toBe("JBSWY3DPEHPK3PXP");
  });

  it("fails closed on invalid MFA key length", () => {
    expect(() => encryptMfaSecret("JBSWY3DPEHPK3PXP", Buffer.alloc(31, 9))).toThrow(/invalid_mfa_encryption_key_length/);
  });

  it("redacts bearer credentials and atypical security field names while keeping public metadata", () => {
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload+/=")).toBe("authorization: [REDACTED]");
    expect(redact({
      clientSecret: "secret",
      digest: "abc",
      sessionId: "123",
      displayName: "Reference API",
      keyId: "kid-v1"
    })).toEqual({
      clientSecret: "[REDACTED]",
      digest: "[REDACTED]",
      sessionId: "[REDACTED]",
      displayName: "Reference API",
      keyId: "kid-v1"
    });
  });
});
