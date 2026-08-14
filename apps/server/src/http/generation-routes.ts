import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import {
  cancelGenerationJob,
  confirmGenerationPlan,
  createGenerationJob,
  createGenerationFollowUpJob,
  ensurePlatformOpenAiSecret,
  generationOpenAiReady,
  getGenerationJob,
  listGenerationJobs,
  submitGenerationInputs
} from "../domain/generation.js";
import { requireCsrf, sessionAccount } from "./admin-routes.js";
import { hostOf, sendError } from "./errors.js";

const createSchema = z.object({ prompt: z.string().trim().min(3).max(50_000) }).strict();
const apiKeySchema = z.object({ value: z.string().trim().min(20).max(20_000) }).strict();
const inputSchema = z.object({ values: z.record(z.string(), z.unknown()) }).strict();
const followUpSchema = z.object({ instruction: z.string().trim().min(3).max(50_000) }).strict();
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
      const body = createSchema.parse(request.body); const job = await createGenerationJob(db, session.accountId, body.prompt, correlationId); return reply.code(202).send({ job, correlationId });
    } catch (error) { return routeError(reply, error, correlationId); }
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

  app.post("/api/generation/jobs/:id/confirm", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id } = idParams.parse(request.params); return { job: await confirmGenerationPlan(db, id, session.accountId, correlationId), correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/generation/jobs/:id/cancel", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id } = idParams.parse(request.params); await cancelGenerationJob(db, id, session.accountId, correlationId); return { ok: true, correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });
}
