import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { registerComponentRoutes } from "./component-routes.js";

const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");

describe("component public route protection", () => {
  let app: FastifyInstance;
  let routeRateLimits: Map<string, unknown>;

  beforeEach(async () => {
    const config: AppConfig = loadConfig({
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
    routeRateLimits = new Map();
    app.addHook("onRoute", (route) => {
      const rateLimit = (route.config as { rateLimit?: unknown } | undefined)?.rateLimit;
      if (rateLimit) routeRateLimits.set(`${String(route.method)} ${route.url}`, rateLimit);
    });
    registerComponentRoutes(app, db, config);
    await app.ready();
  });

  afterEach(async () => app?.close());

  it("rate limits discovery, Pulse and sequential audit ingest", () => {
    expect(routeRateLimits.get("GET /.well-known/kcml-component")).toEqual({ max: 60, timeWindow: "1 minute" });
    expect(routeRateLimits.get("POST /v2/component-pulse")).toEqual({ max: 120, timeWindow: "1 minute" });
    expect(routeRateLimits.get("POST /v2/component-audit-events")).toEqual({ max: 600, timeWindow: "1 minute" });
  });
});
