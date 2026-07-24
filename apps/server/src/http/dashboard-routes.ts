import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { compareDashboardStreamItems, dashboardStreamItemIsAfter } from "../domain/dashboard-event-stream.js";
import {
  bulkGrantDashboardSecret,
  createDashboardConnection,
  dashboardRuntimeEventFromExternalRow,
  dashboardRuntimeEventFromLeaseRow,
  dashboardRuntimeEventFromOperationRow,
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
  positions: z.array(z.object({ nodeId: z.string().uuid(), x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).strict()).max(2000),
  externalPositions: z.array(z.object({ externalTargetId: z.string().uuid(), x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }).strict()).max(2000).default([])
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
    config: { rateLimit: { max: 30, timeWindow: "1 minute", groupId: "dashboard-events" } }
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
    let lastReceivedUs = BigInt(Date.now() - 5 * 60_000) * 1000n;
    let lastEventRank = 0;
    let lastEventKey = "";
    const requestedCursor = String(request.headers["last-event-id"] ?? "").trim();
    const cursorMatch = /^(pulse|external|lease):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?::(PENDING|FINAL))?$/i.exec(requestedCursor);
    const legacyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCursor) ? requestedCursor : null;
    if (cursorMatch?.[1] === "pulse" || legacyUuid) {
      const id = cursorMatch?.[2] ?? legacyUuid;
      const cursor = await db.query("select id,floor(extract(epoch from received_at)*1000000)::bigint received_us from component_operation_event where id=$1", [id]);
      if (cursor.rowCount) {
        lastEventRank = 1;
        lastEventKey = `pulse:${String(cursor.rows[0].id)}`;
        lastReceivedUs = BigInt(String(cursor.rows[0].received_us));
      }
    } else if (cursorMatch?.[1] === "lease") {
      const cursor = await db.query("select id,floor(extract(epoch from started_at)*1000000)::bigint received_us from component_operation_lease where id=$1", [cursorMatch[2]]);
      if (cursor.rowCount) {
        lastEventRank = 0;
        lastEventKey = `lease:${String(cursor.rows[0].id)}`;
        lastReceivedUs = BigInt(String(cursor.rows[0].received_us));
      }
    } else if (cursorMatch?.[1] === "external") {
      const phase = String(cursorMatch?.[3] ?? "FINAL").toUpperCase();
      const cursor = await db.query(
        `select id,floor(extract(epoch from (case when $2='PENDING' then created_at else coalesce(completed_at,created_at) end))*1000000)::bigint received_us
           from component_external_gateway_call where id=$1`,
        [cursorMatch[2], phase]
      );
      if (cursor.rowCount) {
        lastEventRank = phase === "PENDING" ? 0 : 1;
        lastEventKey = `external:${String(cursor.rows[0].id)}:${phase}`;
        lastReceivedUs = BigInt(String(cursor.rows[0].received_us));
      }
    }
    let sending = false;
    const sendPersisted = async () => {
      if (closed || sending) return;
      sending = true;
      try {
      const [pulseResult, leaseResult, externalResult] = await Promise.all([
        db.query(
          `select event.id,event.component_id,component.code,event.pulse_type,event.direction,event.operation_key,event.success,
                  event.process_trace,event.correlation_id,event.trace_id,event.occurred_at,event.received_at,
                  floor(extract(epoch from event.received_at)*1000000)::bigint received_us
             from component_operation_event event join component on component.id=event.component_id
            where event.received_at >= to_timestamp($1::numeric / 1000000)
            order by event.received_at,event.id limit 250`,
          [lastReceivedUs.toString()]
        ),
        db.query(
          `select lease.id,lease.target_component_id,component.code,lease.operation_kind,lease.operation_name,lease.process_trace,
                  lease.started_at,lease.expires_at,lease.correlation_id,lease.trace_id,
                  floor(extract(epoch from lease.started_at)*1000000)::bigint received_us
             from component_operation_lease lease
             join component on component.id=lease.target_component_id
            where lease.started_at >= to_timestamp($1::numeric / 1000000)
            order by lease.started_at,lease.id limit 250`,
          [lastReceivedUs.toString()]
        ),
        db.query(
          `select call.id,call.source_component_id,component.code,call.external_target_id,target.target_key,target.base_url,
                  call.route_path,call.scope_name,call.status,call.http_status,call.error_code,call.attempt_count,
                  call.correlation_id,call.created_at,call.completed_at,phase.event_phase,phase.event_at,
                  floor(extract(epoch from phase.event_at)*1000000)::bigint received_us
             from component_external_gateway_call call
             join component on component.id=call.source_component_id
             join component_external_target target on target.id=call.external_target_id
             cross join lateral (
               select 'PENDING'::text event_phase,call.created_at event_at
               union all
               select 'FINAL'::text event_phase,call.completed_at event_at where call.completed_at is not null
             ) phase
            where phase.event_at >= to_timestamp($1::numeric / 1000000)
            order by phase.event_at,call.id,phase.event_phase desc limit 500`,
          [lastReceivedUs.toString()]
        )
      ]);
      const events = [
        ...pulseResult.rows.map((row) => ({ key: `pulse:${String(row.id)}`, orderUs: BigInt(String(row.received_us)), orderRank: 1, event: dashboardRuntimeEventFromOperationRow(row as Record<string, unknown>) })),
        ...leaseResult.rows.map((row) => ({ key: `lease:${String(row.id)}`, orderUs: BigInt(String(row.received_us)), orderRank: 0, event: dashboardRuntimeEventFromLeaseRow(row as Record<string, unknown>) })),
        ...externalResult.rows.map((row) => {
          const phase = String(row.event_phase) === "PENDING" ? "PENDING" : "FINAL";
          return {
            key: `external:${String(row.id)}:${phase}`,
            orderUs: BigInt(String(row.received_us)),
            orderRank: phase === "PENDING" ? 0 : 1,
            event: dashboardRuntimeEventFromExternalRow({
              ...(row as Record<string, unknown>),
              status: phase === "PENDING" ? "PENDING" : row.status,
              completed_at: phase === "PENDING" ? null : row.completed_at
            })
          };
        })
      ].sort(compareDashboardStreamItems);
      for (const item of events) {
        if (!dashboardStreamItemIsAfter(item, { orderUs: lastReceivedUs, orderRank: lastEventRank, key: lastEventKey })) continue;
        lastReceivedUs = item.orderUs;
        lastEventRank = item.orderRank;
        lastEventKey = item.key;
        reply.raw.write(`id: ${item.key}\nevent: runtime\ndata: ${JSON.stringify(item.event)}\n\n`);
      }
      } finally {
        sending = false;
      }
    };
    reply.raw.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ correlationId, source: "persisted_component_operation_lease+component_operation_event+component_external_gateway_call", replayCursor: requestedCursor || null })}\n\n`);
    await sendPersisted().catch(() => undefined);
    const poll = setInterval(() => { void sendPersisted().catch(() => undefined); }, 1500);
    const heartbeat = setInterval(() => { if (!closed) reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString(), cursor: lastEventKey || null })}\n\n`); }, 12000);
    request.raw.on("close", () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  });
}
