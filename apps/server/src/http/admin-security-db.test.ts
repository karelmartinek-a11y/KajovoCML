import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { loadConfig, type AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { getLoginLockState, recordLoginFailure } from "./admin-routes.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";

describe.skipIf(!enabled)("admin login throttle PostgreSQL concurrency", () => {
  let db: Db;
  let config: AppConfig;
  const request = { ip: "203.0.113.25", headers: {}, cookies: {} } as FastifyRequest;

  beforeAll(() => {
    config = loadConfig(process.env);
    db = createDb(config);
  });
  beforeEach(async () => {
    await db.query("truncate table admin_login_throttle");
  });
  afterAll(async () => db.end());

  it("serializes concurrent failures across IP, account and combined scopes", async () => {
    await Promise.all(Array.from({ length: 5 }, () => recordLoginFailure(db, request, "Admin", config)));

    const buckets = await db.query(
      "select count(*)::int as bucket_count,min(failure_count)::int as minimum_count,max(failure_count)::int as maximum_count from admin_login_throttle"
    );
    expect(buckets.rows[0]).toMatchObject({ bucket_count: 3, minimum_count: 5, maximum_count: 5 });
    await expect(getLoginLockState(db, request, "admin", config)).resolves.toMatchObject({ blocked: true });
  });
});
