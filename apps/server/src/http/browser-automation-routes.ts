import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import {
  createBrowserAutomationDefinition,
  createBrowserAutomationAuthBinding,
  createBrowserAutomationRevision,
  createBrowserAutomationRun,
  getBrowserAutomation,
  getBrowserAutomationRun,
  listBrowserAutomationRevisions,
  listBrowserAutomationRuns,
  listBrowserAutomations,
  preflightBrowserAutomation,
  readBrowserAutomationArtifact,
  reauthenticateBrowserAutomation,
  repairBrowserAutomation,
  requestBrowserAutomationCancel,
  setBrowserAutomationEnabled,
  verifyBrowserAutomationRevision,
  activateBrowserAutomationRevision
} from "../domain/browser-automation.js";
import { ownerSession, routeError } from "./generation-routes.js";

const id = z.object({ id: z.string().uuid() }).strict();
const runId = z.object({ runId: z.string().uuid() }).strict();
const definitionSchema = z.object({ code: z.string().trim().min(3).max(80), displayName: z.string().trim().min(1).max(160), purpose: z.string().trim().max(2_000).optional(), ownerComponentId: z.string().uuid().nullable().optional() }).strict();
const revisionSchema = z.object({ manifest: z.record(z.unknown()) }).strict();
const authBindingSchema = z.object({ stableSecretName: z.string().trim().min(3).max(128), mode: z.enum(["SECRET_MANAGER", "HYBRID", "OWNER_CHALLENGE"]).default("SECRET_MANAGER") }).strict();
const verificationSchema = z.object({ input: z.record(z.unknown()).default({}) }).strict();
const runSchema = z.object({ input: z.record(z.unknown()).default({}), idempotencyKey: z.string().trim().min(1).max(200), callerPrincipalId: z.string().uuid().nullable().optional() }).strict();

export function registerBrowserAutomationRoutes(app: FastifyInstance, db: Db, config: AppServerConfig): void {
  app.get("/api/browser-automations", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { return reply.header("cache-control", "no-store").send({ automations: await listBrowserAutomations(db), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const body = definitionSchema.parse(request.body); const definitionId = await createBrowserAutomationDefinition(db, body, session.accountId, correlationId); return reply.code(201).send({ definitionId, correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/browser-automations/:id", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); return reply.header("cache-control", "no-store").send({ automation: await getBrowserAutomation(db, definitionId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/revisions", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); const body = revisionSchema.parse(request.body); return reply.code(201).send({ revision: await createBrowserAutomationRevision(db, definitionId, body.manifest, session.accountId, correlationId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/browser-automations/:id/revisions", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); return reply.header("cache-control", "no-store").send({ revisions: await listBrowserAutomationRevisions(db, definitionId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/auth-bindings", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); const body = authBindingSchema.parse(request.body); await createBrowserAutomationAuthBinding(db, definitionId, body.stableSecretName, body.mode, session.accountId, correlationId); return reply.code(201).send({ ok: true, correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/preflight", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); return { preflight: await preflightBrowserAutomation(db, definitionId, session.accountId, correlationId), correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/revisions/:revisionId/verify", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try {
      const params = z.object({ id: z.string().uuid(), revisionId: z.string().uuid() }).parse(request.params);
      const body = verificationSchema.parse(request.body);
      return { verification: await verifyBrowserAutomationRevision(db, config, params.id, params.revisionId, body.input, session.accountId, correlationId), correlationId };
    } catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/revisions/:revisionId/activate", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const params = z.object({ id: z.string().uuid(), revisionId: z.string().uuid() }).parse(request.params); await activateBrowserAutomationRevision(db, params.id, params.revisionId, session.accountId, correlationId); return { ok: true, correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/run", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); const body = runSchema.parse(request.body); return reply.code(202).send({ run: await createBrowserAutomationRun(db, definitionId, body.input, body.idempotencyKey, body.callerPrincipalId ?? null, session.accountId, correlationId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/browser-automations/:id/runs", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); return reply.header("cache-control", "no-store").send({ runs: await listBrowserAutomationRuns(db, definitionId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/browser-automation-runs/:runId", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try { const { runId: automationRunId } = runId.parse(request.params); return reply.header("cache-control", "no-store").send({ run: await getBrowserAutomationRun(db, automationRunId), correlationId }); }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automation-runs/:runId/cancel", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { runId: automationRunId } = runId.parse(request.params); await requestBrowserAutomationCancel(db, automationRunId, session.accountId, correlationId); return { ok: true, correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.post("/api/browser-automations/:id/reauthenticate", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); await reauthenticateBrowserAutomation(db, definitionId, session.accountId, session.reauthenticatedAt, correlationId); return { ok: true, correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  for (const [method, enabled] of [["enable", true], ["disable", false]] as const) {
    app.post(`/api/browser-automations/:id/${method}`, async (request, reply) => {
      const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
      try { const { id: definitionId } = id.parse(request.params); await setBrowserAutomationEnabled(db, definitionId, enabled, session.accountId, correlationId); return { ok: true, enabled, correlationId }; }
      catch (error) { return routeError(reply, error, correlationId); }
    });
  }

  app.post("/api/browser-automations/:id/repair", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId, true); if (!session) return;
    try { const { id: definitionId } = id.parse(request.params); return { repair: await repairBrowserAutomation(db, definitionId, session.accountId, correlationId), correlationId }; }
    catch (error) { return routeError(reply, error, correlationId); }
  });

  app.get("/api/browser-automation-runs/:runId/artifacts/:artifactId", async (request, reply) => {
    const correlationId = randomUUID(); const session = await ownerSession(db, config, request, reply, correlationId); if (!session) return;
    try {
      const params = z.object({ runId: z.string().uuid(), artifactId: z.string().uuid() }).parse(request.params);
      const artifact = await readBrowserAutomationArtifact(db, config, params.runId, params.artifactId);
      return reply.header("cache-control", "private, no-store").type(artifact.contentType).send(artifact.body);
    } catch (error) { return routeError(reply, error, correlationId); }
  });
}
