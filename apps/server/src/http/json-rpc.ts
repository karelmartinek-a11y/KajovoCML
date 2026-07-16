import type { FastifyReply } from "fastify";

export type JsonRpcId = string | number | null;
export type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data: Record<string, unknown>;
  };
};
export type JsonRpcResponse = JsonRpcError | {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
};

export function normalizedJsonRpcId(id: unknown): JsonRpcId {
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

export function jsonRpcError(id: unknown, code: number, message: string, correlationId: string, extra?: Record<string, unknown>): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id: normalizedJsonRpcId(id),
    error: { code, message, data: { correlationId, ...(extra ?? {}) } }
  };
}

export function jsonRpcResult(id: unknown, result: Record<string, unknown>): JsonRpcResponse {
  return { jsonrpc: "2.0", id: normalizedJsonRpcId(id), result };
}

export function sendJsonRpc(reply: FastifyReply, payload: JsonRpcResponse): FastifyReply {
  reply.header("content-type", "application/json; charset=utf-8");
  return reply.send(payload);
}

export function respondToJsonRpc(reply: FastifyReply, requestId: unknown, payload: JsonRpcResponse): FastifyReply {
  if (requestId === undefined) return reply.code(204).send();
  return sendJsonRpc(reply, payload);
}

export function mapMcpRuntimeError(error: unknown): { code: number; message: string; classification: string; eventType: string } {
  const errorCode = error instanceof Error ? error.message : "unknown";
  const classification = typeof error === "object" && error && "classification" in error
    ? String(error.classification)
    : errorCode === "output_schema_failed" ? "schema" : "handler";
  if (classification === "timeout") return { code: -32005, message: "Handler timed out", classification, eventType: "mcp.timeout" };
  if (classification === "size") return { code: -32006, message: "Handler response exceeded the registered limit", classification, eventType: "mcp.response_too_large" };
  if (classification === "schema") return { code: -32603, message: "Output schema validation failed", classification, eventType: "mcp.output_schema_failed" };
  if (classification === "saturation") return { code: -32004, message: "Registered tool concurrency limit exceeded", classification, eventType: "mcp.concurrency_rejected" };
  if (classification === "upstream") return { code: -32603, message: "Handler failed", classification, eventType: "mcp.upstream_failed" };
  return { code: -32603, message: "Handler failed", classification, eventType: "mcp.invocation.failed" };
}
