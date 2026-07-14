import { describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret, issueOpaqueSecret, SECRET_BYTES, fingerprintSecret, hmacToken } from "./secrets.js";

describe("KCML secrets", () => {
  it("issues client and bearer secrets from at least 64 random bytes", () => {
    const issued = issueOpaqueSecret();
    const decoded = Buffer.from(issued.value, "base64url");
    expect(decoded.length).toBe(SECRET_BYTES);
    expect(issued.value).not.toContain("=");
    expect(issued.fingerprint).toHaveLength(16);
  });

  it("uses keyed lookup digests and non-verifying fingerprints", () => {
    const key = Buffer.alloc(32, 7);
    const digestA = hmacToken("token-a", key);
    const digestB = hmacToken("token-b", key);
    expect(digestA.equals(digestB)).toBe(false);
    expect(fingerprintSecret("token-a")).not.toEqual(digestA.toString("hex"));
  });

  it("encrypts MFA secrets while preserving compatibility fallback for plaintext", () => {
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP", key);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptMfaSecret(encrypted, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(decryptMfaSecret("JBSWY3DPEHPK3PXP", key)).toBe("JBSWY3DPEHPK3PXP");
  });
});
