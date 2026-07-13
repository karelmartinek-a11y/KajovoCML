import { describe, expect, it } from "vitest";
import { isExpiredAdminSession } from "./session-auth.js";

describe("admin session expiry handling", () => {
  it("returns to login only for an unauthorized admin session", () => {
    expect(isExpiredAdminSession(401, "unauthorized")).toBe(true);
    expect(isExpiredAdminSession(401, "invalid_login")).toBe(false);
    expect(isExpiredAdminSession(401, "invalid_integration_token")).toBe(false);
    expect(isExpiredAdminSession(403, "csrf_failed")).toBe(false);
  });
});
