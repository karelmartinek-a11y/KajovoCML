import type { FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";

const SAFE_ERROR_CODE = /^[a-z][a-z0-9_.]{1,95}$/;

export function sendError(reply: FastifyReply, statusCode: number, error: string, message?: string, correlationId: string = randomUUID()): FastifyReply {
  const code = SAFE_ERROR_CODE.test(error) ? error : "internal_error";
  return reply.code(statusCode).send({
    error: code,
    message: message ?? code,
    correlationId
  });
}

export function hostOf(headersHost: string | undefined): string {
  return (headersHost ?? "").split(":")[0]?.toLowerCase() ?? "";
}
