import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { registerAdminRoutes } from "./admin-routes.js";

const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");

describe("automatic-onboarding-only registration surface", () => {
  let app: FastifyInstance;
  let config: AppConfig;

  beforeEach(async () => {
    config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused/test",
      ACCESS_TOKEN_HMAC_KEY_BASE64: secret(1),
      INTEGRATION_TOKEN_HMAC_KEY_BASE64: secret(2),
      EGRESS_CAPABILITY_HMAC_KEY_BASE64: secret(3),
      SESSION_SECRET_BASE64: secret(4),
      CSRF_SECRET_BASE64: secret(5),
      MFA_ENCRYPTION_KEY_BASE64: secret(6)
    });
    const db = { query: async () => ({ rowCount: 0, rows: [] }) } as unknown as Db;
    app = Fastify();
    await app.register(cookie, { secret: config.SESSION_SECRET_BASE64.toString("base64url") });
    registerAdminRoutes(app, db, config);
    await app.ready();
  });

  afterEach(async () => app?.close());

  it.each([
    "/api/mcp-servers/home-assistant-inventory",
    "/api/mcp-servers/example/trial",
    "/api/mcp-servers/example/mcp-test",
    "/api/mcp-servers/example/bind-manifest",
    "/api/mcp-servers/example/disable",
    "/api/mcp-servers/example/resume",
    "/api/mcp-servers/example/acceptance",
    "/api/mcp-servers/example/activate"
  ])("does not expose the legacy manual route %s", async (url) => {
    const response = await app.inject({ method: "POST", url, headers: { host: config.ADMIN_HOST } });
    expect(response.statusCode).toBe(404);
  });

  it("reports bootstrapRequired in session state when no configured admin exists", async () => {
    const response = await app.inject({ method: "GET", url: "/api/session", headers: { host: config.ADMIN_HOST } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: false, bootstrapRequired: true });
  });

  it("creates the first bootstrap admin account", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select count(*)::int as count from admin_account where password_hash is not null")) {
        return { rowCount: 1, rows: [{ count: 0 }] };
      }
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("insert into admin_account")) {
        return { rowCount: 1, rows: [{ id: "account-id", username: "bootstrap" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    await app.close();
    const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Db;
    app = Fastify();
    await app.register(cookie, { secret: config.SESSION_SECRET_BASE64.toString("base64url") });
    registerAdminRoutes(app, db, config);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/bootstrap/setup",
      headers: { host: config.ADMIN_HOST },
      payload: { username: "bootstrap", password: "very-strong-password", mfaSecret: "" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ username: "bootstrap" });
    expect(response.json().recoveryCodes).toHaveLength(8);
  });
});
