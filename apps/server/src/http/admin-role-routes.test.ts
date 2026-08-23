import argon2 from "argon2";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { registerAdminRoutes } from "./admin-routes.js";

const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");
const sessionToken = "role-test-session-token";
const csrfToken = "role-test-csrf-token";

describe("single OWNER human role and bootstrap enforcement", () => {
  let app: FastifyInstance;
  let config: AppConfig;

  beforeEach(() => {
    config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused/test",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret(1),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: secret(3),
      SESSION_SECRET_BASE64: secret(4),
      CSRF_SECRET_BASE64: secret(5),
      MFA_ENCRYPTION_KEY_BASE64: secret(6)
    });
  });

  afterEach(async () => app?.close());

  async function appForSession(storedRole: "OWNER" | "ADMIN" | "AUDITOR", reauthenticatedAt = new Date().toISOString()) {
    const sessionHash = await argon2.hash(sessionToken, { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from admin_session s")) {
        return { rowCount: 1, rows: [{ id: "session-id", account_id: "account-id", session_hash: sessionHash, username: "operator", role: storedRole, reauthenticated_at: reauthenticatedAt }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Db;
    app = Fastify();
    await app.register(cookie, { secret: config.SESSION_SECRET_BASE64.toString("base64url") });
    registerAdminRoutes(app, db, config);
    await app.ready();
    return query;
  }

  it("normalizes every authenticated human session to OWNER", async () => {
    await appForSession("AUDITOR");
    const headers = { host: config.ADMIN_HOST, cookie: `__Host-kcml_session=${sessionToken}; __Host-kcml_csrf=${csrfToken}`, "x-csrf-token": csrfToken };
    const session = await app.inject({ method: "GET", url: "/api/session", headers });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ authenticated: true, account: "operator", role: "OWNER" });
    const accounts = await app.inject({ method: "GET", url: "/api/admin-accounts", headers });
    expect(accounts.statusCode).toBe(200);
  });

  it("rejects human role creation and mutation fields", async () => {
    await appForSession("ADMIN");
    const headers = { host: config.ADMIN_HOST, cookie: `__Host-kcml_session=${sessionToken}; __Host-kcml_csrf=${csrfToken}`, "x-csrf-token": csrfToken };
    const response = await app.inject({
      method: "POST",
      url: "/api/admin-accounts",
      headers,
      payload: { username: "another-owner", password: "a-long-safe-password", role: "ADMIN" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "admin_account_input_invalid" });
    const update = await app.inject({
      method: "PATCH",
      url: "/api/admin-accounts/account-id",
      headers,
      payload: { role: "AUDITOR" }
    });
    expect(update.statusCode).toBe(400);
    expect(update.json()).toMatchObject({ error: "admin_account_input_invalid" });
  });

  it("requires a fresh authentication for risky changes", async () => {
    await appForSession("OWNER", new Date(Date.now() - 11 * 60 * 1000).toISOString());
    const response = await app.inject({
      method: "PUT",
      url: "/api/operational-config/logLevel",
      headers: { host: config.ADMIN_HOST, cookie: `__Host-kcml_session=${sessionToken}; __Host-kcml_csrf=${csrfToken}`, "x-csrf-token": csrfToken },
      payload: { value: "info" }
    });
    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ error: "reauthentication_required" });
  });

  it("completes bootstrap once without forcing MFA during first setup", async () => {
    let completed = false;
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("select completed from admin_bootstrap_state")) return { rowCount: 1, rows: [{ completed }] };
      if (sql.includes("select 1 from admin_account where active=true")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into admin_account")) return { rowCount: 1, rows: [{ id: "owner-id", username: "first-owner" }] };
      if (sql.includes("update admin_bootstrap_state")) { completed = true; return { rowCount: 1, rows: [] }; }
      if (sql.includes("append_audit_event") || sql.includes("update admin_account") || sql.includes("insert into admin_recovery_code")) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Db;
    app = Fastify();
    await app.register(cookie, { secret: config.SESSION_SECRET_BASE64.toString("base64url") });
    registerAdminRoutes(app, db, config);
    await app.ready();
    const payload = { username: "first-owner", password: "a-long-safe-password" };
    const first = await app.inject({ method: "POST", url: "/api/bootstrap", headers: { host: config.ADMIN_HOST }, payload });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().recoveryCodes).toHaveLength(0);
    const second = await app.inject({ method: "POST", url: "/api/bootstrap", headers: { host: config.ADMIN_HOST }, payload });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "bootstrap_completed" });
  });
});
