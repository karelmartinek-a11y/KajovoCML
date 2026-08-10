import http from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppServerConfig } from "../config.js";
import type { Db } from "../db.js";
import { appendAudit } from "../domain/audit.js";
import { isKcmlHostname } from "../domain/hostnames.js";
import { platformWorkerSecretPrincipal, resolveSecret } from "../domain/secret-manager.js";
import { hostOf, sendError } from "./errors.js";

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

type WebhookContract = {
  componentId: string;
  componentCode: string;
  revisionId: string;
  hostname: string;
  enabled: boolean;
  ingressEnabled: boolean;
  activationState: string;
  endpointId: string;
  path: string;
  methods: string[];
  authMode: string;
  authConfig: Record<string, unknown>;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  socketPath: string;
  runtimeSecretName: string;
  conformanceProbe: boolean;
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function configText(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" && value ? value : fallback;
}

async function contractFor(db: Db, hostname: string, method: string, pathname: string): Promise<WebhookContract | null> {
  const result = await db.query(
    `select c.id component_id,c.code,c.hostname,c.enabled,c.ingress_enabled,c.activation_state,c.active_revision_id,
            endpoint.endpoint_id,endpoint.path,endpoint.methods,endpoint.auth_mode,endpoint.auth_config,
            endpoint.request_schema,endpoint.response_schema,target.socket_path,identity.stable_secret_name,
            exists(
              select 1 from generation_component gc join generation_job job on job.id=gc.job_id
               where gc.component_id=c.id and job.state in ('INTEGRATING','VALIDATING','CML_CONFORMANCE')
            ) as conformance_probe
       from component c
       join component_endpoint_contract endpoint on endpoint.component_id=c.id and endpoint.revision_id=c.active_revision_id
       join component_runtime_target target on target.component_id=c.id and target.revision_id=c.active_revision_id and target.transport='UDS'
       join component_runtime_identity identity on identity.component_id=c.id
      where lower(c.hostname::text)=lower($1) and c.registration_type='INTERNAL_GENERATED'
        and endpoint.path=$2 and endpoint.auth_mode='EXTERNAL_WEBHOOK'
        and (
          $3=any(endpoint.methods)
          or ($3='GET' and endpoint.auth_config->>'type' in ('CHALLENGE_TOKEN','CHALLENGE_AND_HMAC'))
        )`,
    [hostname, pathname, method]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    componentId: String(row.component_id), componentCode: String(row.code), revisionId: String(row.active_revision_id), hostname: String(row.hostname),
    enabled: Boolean(row.enabled), ingressEnabled: Boolean(row.ingress_enabled), activationState: String(row.activation_state),
    endpointId: String(row.endpoint_id), path: String(row.path), methods: Array.isArray(row.methods) ? (row.methods as unknown[]).filter((entry): entry is string => typeof entry === "string") : [],
    authMode: String(row.auth_mode), authConfig: (row.auth_config ?? {}) as Record<string, unknown>,
    requestSchema: row.request_schema as Record<string, unknown>, responseSchema: row.response_schema as Record<string, unknown>,
    socketPath: String(row.socket_path), runtimeSecretName: String(row.stable_secret_name), conformanceProbe: Boolean(row.conformance_probe)
  };
}

async function componentVerificationSecret(db: Db, config: AppServerConfig, contract: WebhookContract, name: string, correlationId: string): Promise<string> {
  if (!name) throw Object.assign(new Error("webhook_verification_secret_missing"), { statusCode: 409 });
  return (await resolveSecret(db, config, {
    kind: "COMPONENT", id: contract.componentId, publicId: contract.componentCode, auditActorType: "component"
  }, name, correlationId)).value;
}

async function verifyExternalWebhook(
  request: FastifyRequest,
  rawBody: Buffer,
  contract: WebhookContract,
  db: Db,
  config: AppServerConfig,
  correlationId: string
): Promise<{ challenge: string | null }> {
  const verificationType = configText(contract.authConfig, "type");
  const usesChallenge = verificationType === "CHALLENGE_TOKEN" || verificationType === "CHALLENGE_AND_HMAC";
  const usesSignature = verificationType === "HMAC_SHA256" || verificationType === "CHALLENGE_AND_HMAC";
  let challenge: string | null = null;
  if (usesChallenge && request.method === "GET") {
    const tokenQuery = configText(contract.authConfig, "challengeTokenQuery", "hub.verify_token");
    const valueQuery = configText(contract.authConfig, "challengeValueQuery", "hub.challenge");
    const query = request.query as Record<string, unknown>;
    const provided = typeof query[tokenQuery] === "string" ? String(query[tokenQuery]) : "";
    challenge = typeof query[valueQuery] === "string" ? String(query[valueQuery]) : null;
    const expected = await componentVerificationSecret(db, config, contract, configText(contract.authConfig, "challengeSecretName"), correlationId);
    if (!provided || !safeEqual(provided, expected) || challenge === null) throw Object.assign(new Error("webhook_challenge_denied"), { statusCode: 403 });
  }
  if (usesSignature && request.method !== "GET") {
    const headerName = configText(contract.authConfig, "signatureHeader", "x-hub-signature-256").toLowerCase();
    const prefix = configText(contract.authConfig, "signaturePrefix", "sha256=");
    const suppliedHeader = request.headers[headerName];
    const supplied = Array.isArray(suppliedHeader) ? suppliedHeader[0] ?? "" : String(suppliedHeader ?? "");
    const secret = await componentVerificationSecret(db, config, contract, configText(contract.authConfig, "signatureSecretName"), correlationId);
    const expected = `${prefix}${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    if (!supplied || !safeEqual(supplied, expected)) throw Object.assign(new Error("webhook_signature_denied"), { statusCode: 403 });
  }
  if (!usesChallenge && !usesSignature) throw Object.assign(new Error("webhook_verification_contract_invalid"), { statusCode: 409 });
  return { challenge };
}

async function runtimeEndpointCall(contract: WebhookContract, token: string, request: Record<string, unknown>): Promise<{ statusCode: number; headers: Record<string, string>; body: unknown }> {
  const payload = Buffer.from(JSON.stringify({ endpointKey: contract.endpointId, request }));
  return new Promise((resolve, reject) => {
    const runtimeRequest = http.request({
      socketPath: contract.socketPath,
      path: "/v1/kcml/runtime/endpoint",
      method: "POST",
      timeout: 45_000,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": payload.length }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(new Error("generated_webhook_runtime_rejected"), { statusCode: response.statusCode ?? 502 }));
          return;
        }
        try {
          const parsed = JSON.parse(body.toString("utf8"));
          resolve({ statusCode: Number(parsed.statusCode ?? 200), headers: parsed.headers ?? {}, body: parsed.body ?? null });
        } catch { reject(new Error("generated_webhook_runtime_invalid_json")); }
      });
    });
    runtimeRequest.on("timeout", () => runtimeRequest.destroy(new Error("generated_webhook_runtime_timeout")));
    runtimeRequest.on("error", reject);
    runtimeRequest.end(payload);
  });
}

export function registerComponentWebhookRoutes(app: FastifyInstance, db: Db, config: AppServerConfig): void {
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!request.url.split("?")[0]?.startsWith("/webhooks/")) return payload;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > 1024 * 1024) throw Object.assign(new Error("webhook_payload_too_large"), { statusCode: 413 });
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks);
    (request as FastifyRequest & { kcmlRawBody?: Buffer }).kcmlRawBody = raw;
    return Readable.from(raw);
  });

  app.all("/webhooks/*", { config: { rateLimit: { max: 300, timeWindow: "1 minute", groupId: "component-webhook" } } }, async (request, reply) => {
    const correlationId = randomUUID();
    reply.header("x-correlation-id", correlationId);
    const hostname = hostOf(request.headers.host);
    if (!isKcmlHostname(hostname)) return sendError(reply, 404, "not_found", undefined, correlationId);
    const pathname = request.url.split("?")[0] ?? request.url;
    const contract = await contractFor(db, hostname, request.method, pathname);
    if (!contract) return sendError(reply, 404, "webhook_not_found", undefined, correlationId);
    if ((!contract.enabled || !contract.ingressEnabled || contract.activationState !== "ACTIVE") && !contract.conformanceProbe) {
      return sendError(reply, 503, "component_disabled", undefined, correlationId);
    }
    const rawBody = (request as FastifyRequest & { kcmlRawBody?: Buffer }).kcmlRawBody ?? Buffer.alloc(0);
    try {
      const verification = await verifyExternalWebhook(request, rawBody, contract, db, config, correlationId);
      const requestPayload: Record<string, unknown> = {
        method: request.method,
        path: pathname,
        query: request.query ?? {},
        headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => !["authorization", "cookie"].includes(key.toLowerCase()))),
        body: request.body ?? null,
        challenge: verification.challenge
      };
      const providerChallenge = verification.challenge !== null && request.method === "GET";
      if (!providerChallenge) {
        const validateInput = ajv.compile(contract.requestSchema);
        const schemaInput = request.method === "GET" ? request.query ?? {} : request.body ?? {};
        if (!validateInput(schemaInput)) return sendError(reply, 422, "webhook_request_schema_invalid", undefined, correlationId);
      }
      const principal = await platformWorkerSecretPrincipal(db);
      const runtimeToken = (await resolveSecret(db, config, principal, contract.runtimeSecretName, correlationId)).value;
      const runtimeResult = await runtimeEndpointCall(contract, runtimeToken, requestPayload);
      // Provider verification uses provider-defined query parameters, not the callback
      // payload schema. It is still dispatched through the generated runtime so the
      // complete public ingress -> CML -> generated handler path is exercised.
      if (providerChallenge) {
        await appendAudit(db, {
          eventType: "generated_component.webhook.challenge_accepted", actorType: "external", actorId: hostname,
          objectType: "component", objectId: contract.componentId,
          after: { endpointId: contract.endpointId, method: request.method, path: pathname, runtimeStatusCode: runtimeResult.statusCode, conformanceProbe: contract.conformanceProbe }, correlationId
        });
        return reply.code(200).type("text/plain; charset=utf-8").send(verification.challenge);
      }
      const validateOutput = ajv.compile(contract.responseSchema);
      if (!validateOutput(runtimeResult.body)) throw Object.assign(new Error("webhook_response_schema_invalid"), { statusCode: 502 });
      await appendAudit(db, {
        eventType: "generated_component.webhook.accepted", actorType: "external", actorId: hostname,
        objectType: "component", objectId: contract.componentId,
        after: { endpointId: contract.endpointId, method: request.method, path: pathname, statusCode: runtimeResult.statusCode, conformanceProbe: contract.conformanceProbe }, correlationId
      });
      for (const [name, value] of Object.entries(runtimeResult.headers)) {
        if (["content-length", "connection", "transfer-encoding", "set-cookie"].includes(name.toLowerCase())) continue;
        reply.header(name, value);
      }
      return reply.code(runtimeResult.statusCode).send(runtimeResult.body);
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode ?? 403);
      await appendAudit(db, {
        eventType: "generated_component.webhook.denied", actorType: "external", actorId: hostname,
        objectType: "component", objectId: contract.componentId,
        after: { endpointId: contract.endpointId, method: request.method, path: pathname, reason: error instanceof Error ? error.message : "webhook_denied" }, correlationId
      });
      return sendError(reply, statusCode, error instanceof Error ? error.message : "webhook_denied", undefined, correlationId);
    }
  });
}
