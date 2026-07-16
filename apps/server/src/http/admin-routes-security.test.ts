import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { loadConfig, type AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { clearLoginFailures, getLoginLockState, recordLoginFailure, sessionAccount } from "./admin-routes.js";

const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");

type ThrottleRow = {
  failureCount: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  lockedUntil: Date | null;
  updatedAt: Date;
};

function requestFor(ip: string, session?: string): FastifyRequest {
  return {
    ip,
    cookies: session ? { "__Host-kcml_session": session } : {},
    headers: {}
  } as FastifyRequest;
}

function createConfig(): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused/test",
    ACCESS_TOKEN_HMAC_KEY_BASE64: secret(1),
    INTEGRATION_TOKEN_HMAC_KEY_BASE64: secret(2),
    EGRESS_CAPABILITY_HMAC_KEY_BASE64: secret(3),
    SESSION_SECRET_BASE64: secret(4),
    CSRF_SECRET_BASE64: secret(5),
    MFA_ENCRYPTION_KEY_BASE64: secret(6)
  });
}

function createThrottleDb() {
  const rows = new Map<string, ThrottleRow>();

  const query = async (sql: string, params: unknown[] = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.includes("select pg_advisory_xact_lock")) return { rowCount: 1, rows: [{ ok: true }] };
    if (sql.includes("select failure_count,last_failed_at from admin_login_throttle")) {
      const key = Buffer.from(params[0] as Buffer).toString("hex");
      const row = rows.get(key);
      return row
        ? { rowCount: 1, rows: [{ failure_count: row.failureCount, last_failed_at: row.lastFailedAt }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("insert into admin_login_throttle")) {
      const key = Buffer.from(params[0] as Buffer).toString("hex");
      const failureCount = Number(params[1]);
      const lockedUntil = params[2] instanceof Date
        ? params[2]
        : typeof params[2] === "string" || typeof params[2] === "number"
          ? new Date(params[2])
          : null;
      const existing = rows.get(key);
      const now = new Date();
      rows.set(key, {
        failureCount,
        firstFailedAt: existing?.firstFailedAt ?? now,
        lastFailedAt: now,
        lockedUntil,
        updatedAt: now
      });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("select max(greatest(0, ceil(extract(epoch from (locked_until-now()))))::int) as retry_after_seconds")) {
      const keys = params[0] as Buffer[];
      const now = Date.now();
      const retryAfterSeconds = keys.reduce((max, key) => {
        const row = rows.get(Buffer.from(key).toString("hex"));
        if (!row?.lockedUntil || row.lockedUntil.getTime() <= now) return max;
        return Math.max(max, Math.max(0, Math.ceil((row.lockedUntil.getTime() - now) / 1000)));
      }, 0);
      return { rowCount: 1, rows: [{ retry_after_seconds: retryAfterSeconds }] };
    }
    if (sql.includes("delete from admin_login_throttle where attempt_key = any")) {
      const keys = params[0] as Buffer[];
      for (const key of keys) rows.delete(Buffer.from(key).toString("hex"));
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const db = {
    query,
    connect: async () => ({
      query,
      release: () => undefined
    })
  } as unknown as Db;

  return { db, rows };
}

describe("admin route security helpers", () => {
  let config: AppConfig;

  beforeEach(() => {
    config = createConfig();
  });

  it("does not fall back to O(N) legacy admin session scanning", async () => {
    const sqlCalls: string[] = [];
    const db = {
      query: async (sql: string) => {
        sqlCalls.push(sql);
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;

    const session = await sessionAccount(db, requestFor("127.0.0.1", "session-token"), config);
    expect(session).toBeNull();
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]).toContain("where s.lookup_digest=$1");
  });

  it("locks repeated failures across the combined account and IP scope", async () => {
    const { db } = createThrottleDb();
    const request = requestFor("203.0.113.5");

    for (let index = 0; index < 4; index += 1) {
      await recordLoginFailure(db, request, "Admin", config);
    }

    const lock = await getLoginLockState(db, request, "admin", config);
    expect(lock.blocked).toBe(true);
    expect(lock.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clears account-based throttles after a successful login but keeps the IP bucket intact", async () => {
    const { db } = createThrottleDb();
    const request = requestFor("203.0.113.6");

    for (let index = 0; index < 9; index += 1) {
      await recordLoginFailure(db, request, "Admin", config);
    }
    expect((await getLoginLockState(db, request, "admin", config)).blocked).toBe(true);

    await clearLoginFailures(db, request, "admin", config);

    expect((await getLoginLockState(db, request, "admin", config)).blocked).toBe(true);
    expect((await getLoginLockState(db, requestFor("203.0.113.7"), "admin", config)).blocked).toBe(false);
  });
});
