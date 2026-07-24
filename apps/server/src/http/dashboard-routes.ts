import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import {
  bulkGrantDashboardSecret,
  createDashboardConnection,
  dashboardDeregistrationPreview,
  deregisterDashboardNode,
  disconnectDashboardConnection,
  grantDashboardSecretToNode,
  listDashboardIdentityCards,
  listDashboardTopology,
  previewBulkDashboardSecret,
  previewDashboardConnection,
  revokeDashboardSecretFromNode,
  saveDashboardLayout,
  setDashboardConnectionAuthorization,
  setDashboardNodeSuspension
} from "../domain/dashboard-topology.js";
import { requireCsrf, sessionAccount } from "./admin-routes.js";
import { hostOf, sendError } from "./errors.js";

const portReferenceSchema = z.object({
  sourceComponentId: z.string().uuid(),
  sourcePortKey: z.string().min(4).max(300),
  targetComponentId: z.string().uuid(),
  targetPortKey: z.string().min(4).max(300)
}).strict();
const connectSchema = portReferenceSchema.extend({
  targetRoute: z.string().startsWith("/").max(500).optional(),
  targetScope: z.string().min(1).max(200).optional(),
  grantAuthorization: z.boolean().default(true)
}).strict();
const authorizationSchema = z.object({ enabled: z.boolean() }).strict();
const suspensionSchema = z.object({ suspended: z.boolean(), reason: z.string().trim().min(5).max(500) }).strict();
const deregistrationSchema = z.object({
  password: z.string().min(1).max(1000),
  totp: z.string().trim().regex(/^\d{6,8}$/),
  reason: z.string().trim().min(10).max(1000),
  confirmedCode: z.string().trim().min(1).max(100),
  idempotencyKey: z.string().trim().min(8).max(200)
}).strict();
const layoutSchema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
  viewport: z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000), zoom: z.number().min(0.1).max(4) }).strict(),
  positions: z.array(z.object({ nodeId: z.string().uuid(), x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).strict()).max(2000)
}).strict();

async function ownerSession(db: Db, config: AppServerConfig, request: FastifyRequest, reply: FastifyReply, correlationId: string, mutation = false) {
  if (hostOf(request.headers.host) !== config.ADMIN_HOST) {
    sendError(reply, 404, "not_found", undefined, correlationId);
    return null;
  }
  const session = await sessionAccount(db, request, config);
  if (!session) {
    sendError(reply, 401, "unauthorized", undefined, correlationId);
    return null;
  }
  if (session.role !== "OWNER") {
    sendError(reply, 403, "owner_role_required", undefined, correlationId);
    return null;
  }
  if (mutation && !requireCsrf(request)) {
    sendError(reply, 403, "csrf_failed", undefined, correlationId);
    return null;
  }
  return session;
}

function routeError(reply: FastifyReply, error: unknown, correlationId: string) {
  if (error instanceof z.ZodError) return sendError(reply, 400, "validation_failed", error.issues.map((issue) => issue.message).join("; "), correlationId);
  const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
  return sendError(reply, statusCode, error instanceof Error ? error.message : "operation_failed", undefined, correlationId);
}

export function registerDashboardRoutes(app: FastifyInstance, db: Db, config: AppServerConfig): void {
  app.get("/api/dashboard/topology", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId);
    if (!session) return;
    try {
      return reply.header("cache-control", "no-store").send({ topology: await listDashboardTopology(db, session.accountId), correlationId });
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.put("/api/dashboard/layout", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const body = layoutSchema.parse(request.body);
      return { layout: await saveDashboardLayout(db, { ...body, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.post("/api/dashboard/connections/preview", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      return { preview: await previewDashboardConnection(db, portReferenceSchema.parse(request.body)), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.post("/api/dashboard/connections", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const body = connectSchema.parse(request.body);
      return reply.code(201).send({ connection: await createDashboardConnection(db, { ...body, actorId: session.accountId, correlationId }), correlationId });
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.put("/api/dashboard/connections/:id/authorization", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const body = authorizationSchema.parse(request.body);
      const connectionId = z.string().uuid().parse((request.params as { id: string }).id);
      return { connection: await setDashboardConnectionAuthorization(db, { connectionId, enabled: body.enabled, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.delete("/api/dashboard/connections/:id", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const connectionId = z.string().uuid().parse((request.params as { id: string }).id);
      return { result: await disconnectDashboardConnection(db, { connectionId, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.put("/api/dashboard/nodes/:id/suspension", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const body = suspensionSchema.parse(request.body);
      const nodeId = z.string().uuid().parse((request.params as { id: string }).id);
      return { result: await setDashboardNodeSuspension(db, { nodeId, ...body, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.get("/api/dashboard/identity-cards", async (request, reply) => {
    const correlationId = randomUUID();
    if (!await ownerSession(db, config, request, reply, correlationId)) return;
    try {
      return reply.header("cache-control", "no-store").send({ identities: await listDashboardIdentityCards(db), correlationId });
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.post("/api/dashboard/secrets/:secretId/grants", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const secretId = z.string().uuid().parse((request.params as { secretId: string }).secretId);
      const body = z.object({ nodeId: z.string().uuid() }).strict().parse(request.body);
      return { result: await grantDashboardSecretToNode(db, { secretId, nodeId: body.nodeId, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.delete("/api/dashboard/secrets/:secretId/grants/:nodeId", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const params = z.object({ secretId: z.string().uuid(), nodeId: z.string().uuid() }).parse(request.params);
      return { result: await revokeDashboardSecretFromNode(db, { ...params, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.get("/api/dashboard/secrets/:secretId/grants/bulk-preview", async (request, reply) => {
    const correlationId = randomUUID();
    if (!await ownerSession(db, config, request, reply, correlationId)) return;
    try {
      const secretId = z.string().uuid().parse((request.params as { secretId: string }).secretId);
      return { preview: await previewBulkDashboardSecret(db, secretId), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.post("/api/dashboard/secrets/:secretId/grants/bulk", async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const secretId = z.string().uuid().parse((request.params as { secretId: string }).secretId);
      return { result: await bulkGrantDashboardSecret(db, { secretId, actorId: session.accountId, correlationId }), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.get("/api/dashboard/nodes/:id/deregistration-preview", async (request, reply) => {
    const correlationId = randomUUID();
    if (!await ownerSession(db, config, request, reply, correlationId)) return;
    try {
      const nodeId = z.string().uuid().parse((request.params as { id: string }).id);
      return { preview: await dashboardDeregistrationPreview(db, nodeId), correlationId };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.post("/api/dashboard/nodes/:id/deregister", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute", groupId: "dashboard-deregister" } }
  }, async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId, true);
    if (!session) return;
    try {
      const nodeId = z.string().uuid().parse((request.params as { id: string }).id);
      const body = deregistrationSchema.parse(request.body);
      return {
        result: await deregisterDashboardNode(db, config, {
          nodeId,
          actorId: session.accountId,
          correlationId,
          ...body
        }),
        correlationId
      };
    } catch (error) {
      return routeError(reply, error, correlationId);
    }
  });

  app.get("/api/dashboard/events", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute", groupId: "dashboard-events" } }
  }, async (request, reply) => {
    const correlationId = randomUUID();
    const session = await ownerSession(db, config, request, reply, correlationId);
    if (!session) return;
    const accept = String(request.headers.accept ?? "");
    if (!accept.includes("text/event-stream")) {
      const topology = await listDashboardTopology(db, session.accountId);
      return { events: topology.events, live: topology.live, correlationId };
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    let closed = false;
    let lastReceivedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    let lastEventId = "00000000-0000-0000-0000-000000000000";
    const requestedCursor = String(request.headers["last-event-id"] ?? "").trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCursor)) {
      const cursor = await db.query("select id,received_at from component_operation_event where id=$1", [requestedCursor]);
      if (cursor.rowCount) {
        lastEventId = String(cursor.rows[0].id);
        lastReceivedAt = new Date(cursor.rows[0].received_at).toISOString();
      }
    }
    const sendPersisted = async () => {
      if (closed) return;
      const result = await db.query(
        `select event.id,event.component_id,component.code,event.pulse_type,event.direction,event.operation_key,event.success,
                event.correlation_id,event.trace_id,event.occurred_at,event.received_at
           from component_operation_event event join component on component.id=event.component_id
          where event.received_at > $1 or (event.received_at = $1 and event.id > $2::uuid)
          order by event.received_at,event.id limit 200`,
        [lastReceivedAt, lastEventId]
      );
      for (const row of result.rows) {
        lastReceivedAt = new Date(row.received_at).toISOString();
        lastEventId = String(row.id);
        reply.raw.write(`id: ${lastEventId}\nevent: runtime\ndata: ${JSON.stringify({
          id: lastEventId, componentId: String(row.component_id), componentCode: String(row.code), pulseType: row.pulse_type,
          direction: row.direction, operationKey: String(row.operation_key), success: Boolean(row.success),
          correlationId: String(row.correlation_id), traceId: row.trace_id ?? null, occurredAt: row.occurred_at, receivedAt: row.received_at
        })}\n\n`);
      }
    };
    reply.raw.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ correlationId, source: "persisted_component_operation_event", replayCursor: requestedCursor || null })}\n\n`);
    await sendPersisted().catch(() => undefined);
    const poll = setInterval(() => { void sendPersisted().catch(() => undefined); }, 2000);
    const heartbeat = setInterval(() => { if (!closed) reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); }, 15000);
    request.raw.on("close", () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  });
}
