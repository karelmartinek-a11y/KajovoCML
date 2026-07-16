import { createHash } from "node:crypto";
import http from "node:http";
import type { KcmlHandler } from "./registry.js";

type WorkerReply = {
  output?: unknown;
  error?: { code?: string };
  logs?: Array<{ level?: string; message?: string; fields?: Record<string, unknown> }>;
};

const activeByServer = new Map<string, number>();

function abortError(): Error {
  const error = new Error("worker_aborted");
  error.name = "AbortError";
  return error;
}

function invokeSocket(
  socketPath: string,
  payload: Buffer,
  timeoutMs: number,
  maxResponseBytes: number,
  signal?: AbortSignal
): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath,
      path: "/invoke",
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(payload.length) },
      timeout: timeoutMs
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxResponseBytes) response.destroy(new Error("worker_response_too_large"));
        else chunks.push(Buffer.from(chunk));
      });
      response.on("error", reject);
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("worker_http_error"));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as WorkerReply);
        } catch {
          reject(new Error("worker_invalid_response"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("worker_timeout")));
    request.on("error", reject);
    if (signal) {
      const abortRequest = () => request.destroy(abortError());
      if (signal.aborted) {
        abortRequest();
        return;
      }
      signal.addEventListener("abort", abortRequest, { once: true });
      request.on("close", () => signal.removeEventListener("abort", abortRequest));
    }
    request.end(payload);
  });
}

export function ociHandler(): KcmlHandler {
  return {
    key: "oci-dispatcher",
    version: "1",
    async invoke(input, ctx) {
      const { server } = ctx;
      if (!server.runtimeSocket || !server.imageDigest) throw new Error("isolated_worker_unavailable");
      const current = activeByServer.get(server.id) ?? 0;
      if (current >= server.maxConcurrency) throw new Error("worker_concurrency_exceeded");
      const payload = Buffer.from(JSON.stringify({
        input,
        context: {
          correlationId: ctx.correlationId,
          serverCode: server.code,
          toolName: server.toolName,
          handlerVersion: server.handlerVersion,
          imageDigest: server.imageDigest
        }
      }));
      if (payload.length > server.requestMaxBytes + 64 * 1024) throw new Error("worker_request_too_large");
      activeByServer.set(server.id, current + 1);
      try {
        const reply = await invokeSocket(
          server.runtimeSocket,
          payload,
          server.timeoutMs + 1_000,
          server.responseMaxBytes + 128 * 1024,
          ctx.signal
        );
        for (const frame of reply.logs ?? []) {
          const handlerLogDigest = createHash("sha256")
            .update(JSON.stringify({ level: frame.level, message: frame.message, fields: frame.fields }))
            .digest("hex");
          const fields = { serverCode: server.code, imageDigest: server.imageDigest, correlationId: ctx.correlationId, handlerLogDigest };
          if (frame.level === "error") await ctx.logger.error(fields, "handler.error");
          else await ctx.logger.info(fields, "handler.info");
        }
        if (reply.error) {
          throw new Error(String(reply.error.code ?? "worker_failed"));
        }
        return reply.output;
      } finally {
        const next = (activeByServer.get(server.id) ?? 1) - 1;
        if (next <= 0) activeByServer.delete(server.id);
        else activeByServer.set(server.id, next);
      }
    }
  };
}
