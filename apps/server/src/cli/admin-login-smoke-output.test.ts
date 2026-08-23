import { describe, expect, it } from "vitest";
import { serializeAdminLoginSmokeOutput } from "./admin-login-smoke-output.js";

const credentials = {
  username: "owner",
  mfaUsed: true,
  csrfToken: "csrf-secret-value",
  sessionCookie: "session-secret-value",
  csrfCookie: "csrf-secret-value"
};

describe("admin login smoke output", () => {
  it("does not expose session or CSRF credentials in default output", () => {
    const output = serializeAdminLoginSmokeOutput(credentials, false);
    expect(JSON.parse(output)).toEqual({
      ok: true,
      username: "owner",
      mfaUsed: true,
      sessionCookiePresent: true,
      csrfCookiePresent: true,
      csrfContractValid: true
    });
    expect(output).not.toContain("csrf-secret-value");
    expect(output).not.toContain("session-secret-value");
  });

  it("keeps credential transport opt-in for the in-memory reference smoke", () => {
    const output = serializeAdminLoginSmokeOutput(credentials, true);
    expect(JSON.parse(output)).toMatchObject(credentials);
  });
});
