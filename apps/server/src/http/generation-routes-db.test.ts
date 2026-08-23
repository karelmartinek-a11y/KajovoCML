import argon2 from "argon2";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { createGenerationJob, getGenerationJob } from "../domain/generation.js";
import { hmacToken } from "../security/secrets.js";
import { registerGenerationRoutes } from "./generation-routes.js";

const enabled = process.env.KCML_TEST_DATABASE === "1";

describe.skipIf(!enabled)("authenticated generation HTTP/SSE contract", () => {
  let db: Db;
  let app: FastifyInstance;
  let config: AppConfig;
  let baseUrl = "";
  let accountId = "";
  let sessionValue = "";
  let csrfValue = "";
  const jobIds: string[] = [];

  beforeAll(async () => {
    config = loadConfig(process.env);
    db = createDb(config);
    app = Fastify({ logger: false });
    await app.register(cookie, { secret: config.SESSION_SECRET_BASE64.toString("base64url") });
    registerGenerationRoutes(app, db, config);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("generation_http_test_address_missing");
    baseUrl = `http://127.0.0.1:${address.port}`;
    accountId = randomUUID(); sessionValue = randomUUID(); csrfValue = randomUUID();
    const sessionEpoch = randomUUID();
    // The clean migration intentionally has no active OWNER. Keep the seeded
    // bootstrap account as a second OWNER so this authenticated fixture can be
    // removed without violating the database last-owner invariant.
    await db.query("update admin_account set role='OWNER',active=true,activated_at=coalesce(activated_at,now()) where username='karmar78'");
    const sessionHash = await argon2.hash(sessionValue, { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
    await db.query(
      `insert into admin_account(id,username,password_hash,role,active,activated_at,session_epoch)
       values ($1,$2,$3,'OWNER',true,now(),$4)`,
      [accountId, `generation-http-${accountId.slice(0, 8)}`, sessionHash, sessionEpoch]
    );
    await db.query(
      `insert into admin_session(account_id,session_hash,lookup_digest,expires_at,reauthenticated_at,session_epoch)
       values ($1,$2,$3,now()+interval '10 minutes',now(),$4)`,
      [accountId, sessionHash, hmacToken(sessionValue, config.SESSION_SECRET_BASE64), sessionEpoch]
    );
  });

  afterAll(async () => {
    if (!db) return;
    if (jobIds.length) await db.query("delete from generation_job where id=any($1::uuid[])", [jobIds]);
    if (accountId) await db.query("delete from admin_session where account_id=$1", [accountId]);
    if (accountId) await db.query("update admin_account set role='ADMIN',active=false where id=$1", [accountId]);
    if (accountId) await db.query("delete from admin_account where id=$1", [accountId]);
    await app?.close();
    await db.end();
  });

  function headers(mutation = false): Record<string, string> {
    return {
      host: config.ADMIN_HOST,
      cookie: `__Host-kcml_session=${sessionValue}; __Host-kcml_csrf=${csrfValue}`,
      ...(mutation ? { "x-csrf-token": csrfValue } : {})
    };
  }

  function requestJson(path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; json: () => Promise<unknown> }> {
    return new Promise((resolve, reject) => {
      const body = options.body === undefined ? "" : JSON.stringify(options.body);
      const request = http.request({
        hostname: "127.0.0.1", port: new URL(baseUrl).port, path, method: options.method ?? "GET",
        headers: { ...options.headers, host: config.ADMIN_HOST, ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) }
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown }));
      });
      request.on("error", reject);
      if (body) request.write(body);
      request.end();
    });
  }

  function requestSseUntil(path: string, requestHeaders: Record<string, string>, expected: string): Promise<{ status: number; chunk: string; close: () => void }> {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port: new URL(baseUrl).port, path, method: "GET", headers: { ...requestHeaders, host: config.ADMIN_HOST, accept: "text/event-stream" } }, (response) => {
        let body = "";
        const onData = (chunk: Buffer) => {
          body += chunk.toString("utf8");
          if (body.includes(expected)) {
            response.off("data", onData);
            resolve({ status: response.statusCode ?? 0, chunk: body, close: () => request.destroy() });
          }
        };
        response.on("data", onData);
        response.on("end", () => resolve({ status: response.statusCode ?? 0, chunk: body, close: () => request.destroy() }));
        response.on("error", reject);
      });
      request.on("error", (error) => { if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error); });
      request.end();
    });
  }

  it("keeps OWNER auth, persistent messages, SSE replay and cancellation on the same route stack", async () => {
    const created = await createGenerationJob(db, accountId, `HTTP discussion ${randomUUID()}`, randomUUID(), randomUUID());
    jobIds.push(created.job.id);
    const list = await requestJson("/api/generation/jobs", { headers: headers() });
    expect(list.status).toBe(200);
    expect((await list.json() as { jobs: Array<{ id: string; state: string }> }).jobs).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.job.id, state: "DISCUSSING" })]));

    const message = await requestJson(`/api/generation/jobs/${created.job.id}/messages`, {
      method: "POST", headers: headers(true), body: { content: "Přidej bezpečné čtení katalogu.", idempotencyKey: randomUUID() }
    });
    expect(message.status).toBe(202);

    const history = await requestJson(`/api/generation/jobs/${created.job.id}/messages`, { headers: headers() });
    expect(history.status).toBe(200);
    expect((await history.json() as { messages: Array<{ role: string; content: string }> }).messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "OWNER", content: "Přidej bezpečné čtení katalogu." })]));

    const sse = await requestSseUntil(`/api/generation/jobs/${created.job.id}/events?after=0`, headers(), "generation.state.changed");
    expect(sse.status).toBe(200);
    expect(sse.chunk).toContain("generation.state.changed");
    sse.close();

    const cancelled = await requestJson(`/api/generation/jobs/${created.job.id}/cancel`, { method: "POST", headers: headers(true), body: {} });
    expect(cancelled.status).toBe(200);
    expect((await getGenerationJob(db, created.job.id)).state).toBe("CANCELLED");
  });
});
