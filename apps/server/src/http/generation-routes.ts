import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import {
  cancelGenerationJob,
  createGenerationJob,
  createGenerationFollowUpJob,
  ensurePlatformOpenAiSecret,
  generationOpenAiReady,
  getGenerationJob,
  listGenerationJobs,
  submitGenerationInputs
} from "../domain/generation.js";
import { approveSpec, getCurrentSpec, runDiscussionTurn } from "../domain/generation-discussion.js";
import { requireCsrf, sessionAccount } from "./admin-routes.js";
import { hostOf, sendError } from "./errors.js";

const createSchema = z.object({ prompt: z.string().trim().min(3).max(50_000), clientRequestId: z.string().trim().min(1).max(200).optional() }).strict();
const apiKeySchema = z.object({ value: z.string().trim().min(20).max(20_000) }).strict();
const inputSchema = z.object({ values: z.record(z.string(), z.unknown()) }).strict();
const followUpSchema = z.object({ instruction: z.string().trim().min(3).max(50_000) }).strict();
const messageSchema = z.object({ content: z.string().trim().min(1).max(50_000), idempotencyKey: z.string().trim().min(1).max(200).optional() }).strict();
const approvalSchema = z.object({ revisionId: z.string().uuid(), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict();
const idParams = z.object({ id: z.string().uuid() }).strict();

async function ownerSession(db: Db, config: AppServerConfig, request: FastifyRequest, reply: FastifyReply, correlationId: string, mutation = false) {
  if (hostOf(request.headers.host) !== config.ADMIN_HOST) {
    sendError(reply, 404, "not_found", undefined, correlationId); return null;
  }
  const session = await sessionAccount(db, request, config);
  if (!session) { sendError(reply, 401, "unauthorized", undefined, correlationId); return null; }
  if (session.role !== "OWNER") { sendError(reply, 403, "owner_role_required", undefined, correlationId); return null; }
  if (mutation && !requireCsrf(request)) { sendError(reply, 403, "csrf_failed", undefined, correlationId); return null; }
  return session;
}

function routeError(reply: FastifyReply, error: unknown, correlationId: string) {
  if (error instanceof z.ZodError) return sendError(reply, 400, "validation_failed", error.issues.map((issue) => issue.message).join("; "), correlationId);
  const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
  return sendError(reply, statusCode, error instanceof Error ? error.message : "generation_operation_failed", undefined, correlationId);
}

async function ownedJob(db: Db, id: string, ownerId: string) {
  const job = await getGenerationJob(db, id);
  if (job.ownerAdminId !== ownerId) throw Object.assign(new Error("not_found"), { statusCode: 404 });
  return job;
}

export function registerGenerationRoutes(app: FastifyInstance, db: Db, config: AppServerConfig): void {
  app.get("/api/generation/setup", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { return reply.header("cache-control", "no-store").send({ openAiReady: await generationOpenAiReady(db), model: config.GENERATION_OPENAI_MODEL, correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.put("/api/generation/setup/openai-key", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const body = apiKeySchema.parse(request.body); await ensurePlatformOpenAiSecret(db, config, session.accountId, body.value, correlationId); return { openAiReady: true, correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/generation/jobs", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { return reply.header("cache-control", "no-store").send({ jobs: await listGenerationJobs(db, session.accountId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try {
      if (!await generationOpenAiReady(db)) return sendError(reply, 409, "openai_key_required", "Nejdříve uložte OpenAI API key do Secret Manageru.", correlationId);
      const body = createSchema.parse(request.body); const created = await createGenerationJob(db, session.accountId, body.prompt, correlationId, body.clientRequestId); return reply.code(created.idempotent ? 200 : 201).send({ job: created.job, idempotent: created.idempotent, correlationId });
    } catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/generation/jobs/:id/messages", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try {
      const { id } = idParams.parse(request.params); await ownedJob(db, id, session.accountId);
      const query = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
      const result = await db.query("select id,sequence,role,status,content,turn_id,created_at from generation_job_message where job_id=$1 and ($2::bigint is null or sequence<$2) order by sequence desc limit $3", [id, query.before ?? null, query.limit]);
      const messages = result.rows.reverse().map((row) => ({ id: String(row.id), sequence: Number(row.sequence), role: String(row.role), status: String(row.status), content: String(row.content), turnId: row.turn_id ? String(row.turn_id) : null, createdAt: new Date(row.created_at).toISOString() }));
      return reply.header("cache-control", "no-store").send({ messages, nextBefore: result.rowCount === query.limit ? Number(result.rows[0].sequence) : null, correlationId });
    }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs/:id/messages", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try {
      const { id } = idParams.parse(request.params); const body = messageSchema.parse(request.body); await ownedJob(db, id, session.accountId);
      const result = await runDiscussionTurn(db, id, session.accountId, body.content, body.idempotencyKey);
      return reply.code(result.idempotent ? 200 : 202).send({ ...result, correlationId });
    } catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/generation/jobs/:id/spec", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { const { id } = idParams.parse(request.params); await ownedJob(db, id, session.accountId); return reply.header("cache-control", "no-store").send({ spec: await getCurrentSpec(db, id), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs/:id/approve-spec", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id } = idParams.parse(request.params); const body = approvalSchema.parse(request.body); return { approval: await approveSpec(db, id, session.accountId, body.revisionId, body.digest), correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/generation/jobs/:id/events", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    const { id } = idParams.parse(request.params); await ownedJob(db, id, session.accountId);
    const query = z.object({ after: z.coerce.number().int().min(0).optional() }).parse(request.query);
    const after = Number(request.headers["last-event-id"] ?? query.after ?? 0) || 0;
    reply.hijack();
    reply.raw.statusCode = 200; reply.raw.setHeader("content-type", "text/event-stream"); reply.raw.setHeader("cache-control", "no-cache, no-store"); reply.raw.setHeader("x-accel-buffering", "no"); reply.raw.setHeader("connection", "keep-alive");
    const write = (eventId: number | null, type: string, payload: unknown, occurredAt = new Date().toISOString()) => { reply.raw.write(`${eventId === null ? "" : `id: ${eventId}\n`}event: ${type}\ndata: ${JSON.stringify({ eventId, type, jobId: id, emittedAt: occurredAt, payload })}\n\n`); };
    let cursor = after; let closed = false;
    request.raw.on("close", () => { closed = true; });
    for (let i = 0; i < 120 && !closed; i += 1) {
      const events = await db.query("select sequence,type,payload,occurred_at from generation_event where job_id=$1 and sequence>$2 order by sequence limit 101", [id, cursor]);
      if (events.rowCount && Number(events.rows[0].sequence) > cursor + 1) write(null, "generation.resync.required", { after: cursor });
      for (const event of events.rows.slice(0, 100)) { cursor = Number(event.sequence); write(cursor, String(event.type), event.payload, new Date(event.occurred_at).toISOString()); }
      if (!events.rowCount) write(null, "generation.heartbeat", { correlationId });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!closed) reply.raw.end();
  });

  app.get("/api/generation/jobs/:id", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { const { id } = idParams.parse(request.params); return reply.header("cache-control", "no-store").send({ job: await ownedJob(db, id, session.accountId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs/:id/inputs", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id } = idParams.parse(request.params); await ownedJob(db, id, session.accountId); const body = inputSchema.parse(request.body); return { job: await submitGenerationInputs(db, config, id, session.accountId, body.values, correlationId), correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs/:id/runs", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try {
      const { id } = idParams.parse(request.params); const body = followUpSchema.parse(request.body);
      return reply.code(202).send({ job: await createGenerationFollowUpJob(db, id, session.accountId, body.instruction, correlationId), correlationId });
    } catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs/:id/cancel", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id } = idParams.parse(request.params); await cancelGenerationJob(db, id, session.accountId, correlationId); return { ok: true, correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });
}
