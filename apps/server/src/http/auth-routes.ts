import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { issueAccessToken } from "../domain/auth.js";
import { hostOf, sendError } from "./errors.js";

export function registerAuthRoutes(app: FastifyInstance, db: Db, config: AppConfig): void {
  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: `https://${config.AUTH_HOST}`,
    token_endpoint: `https://${config.AUTH_HOST}/oauth/token`,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"]
  }));

  app.post("/oauth/token", async (request, reply) => {
    const correlationId = randomUUID();
    if (hostOf(request.headers.host) !== config.AUTH_HOST) return sendError(reply, 404, "not_found", undefined, correlationId);
    const contentType = request.headers["content-type"] ?? "";
    if (!String(contentType).includes("application/x-www-form-urlencoded")) return sendError(reply, 415, "unsupported_media_type", undefined, correlationId);
    const auth = request.headers.authorization ?? "";
    if (!auth.startsWith("Basic ")) return sendError(reply, 401, "invalid_client", undefined, correlationId);
    const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 1) return sendError(reply, 401, "invalid_client", undefined, correlationId);
    const clientId = decodeURIComponent(decoded.slice(0, sep));
    const clientSecret = decodeURIComponent(decoded.slice(sep + 1));
    const body = request.body as { grant_type?: string; resource?: string };
    if (body.grant_type !== "client_credentials") return sendError(reply, 400, "unsupported_grant_type", undefined, correlationId);
    if (!body.resource) return sendError(reply, 400, "invalid_resource", undefined, correlationId);
    try {
      return await issueAccessToken(db, {
        clientId,
        clientSecret,
        resource: body.resource,
        hmacKey: config.ACCESS_TOKEN_HMAC_KEY_BASE64,
        keyId: config.ACCESS_TOKEN_HMAC_KEY_ID,
        correlationId
      });
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 500;
      const code = error instanceof Error ? error.message : "server_error";
      return sendError(reply, statusCode, code, undefined, correlationId);
    }
  });
}
