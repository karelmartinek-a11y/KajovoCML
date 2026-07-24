import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { registerDashboardRoutes } from "./dashboard-routes.js";

const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");

describe("dashboard route protection", () => {
  let app: FastifyInstance;
  let config: AppConfig;
  let routeRateLimits: Map<string, unknown>;

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
    routeRateLimits = new Map();
    app.addHook("onRoute", (route) => {
      const rateLimit = (route.config as { rateLimit?: unknown } | undefined)?.rateLimit;
      if (rateLimit) routeRateLimits.set(`${String(route.method)} ${route.url}`, rateLimit);
    });
    await app.register(cookie, { secret: config.SESSION_SECRET_BASE64.toString("base64url") });
    registerDashboardRoutes(app, db, config);
    await app.ready();
  });

  afterEach(async () => app?.close());

  it("rate limits dashboard event reads", () => {
    expect(routeRateLimits.get("GET /api/dashboard/events")).toEqual({
      max: 60,
      timeWindow: "1 minute",
      groupId: "dashboard-events"
    });
  });
});
