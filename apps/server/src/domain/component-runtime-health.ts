import http from "node:http";

export type ComponentRuntimeHealthEvidence = { transport: "UDS"; healthStatus: number; readyStatus: number; checkedAt: string };

function udsGet(socketPath: string, requestPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: requestPath, method: "GET", timeout: 3_000 }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("timeout", () => request.destroy(new Error(`component_runtime_${requestPath === "/health" ? "health" : "ready"}_timeout`)));
    request.on("error", reject);
    request.end();
  });
}

export async function probeUdsComponentRuntime(socketPath: string): Promise<ComponentRuntimeHealthEvidence> {
  if (!socketPath.startsWith("/")) throw new Error("component_runtime_socket_invalid");
  const [healthStatus, readyStatus] = await Promise.all([udsGet(socketPath, "/health"), udsGet(socketPath, "/ready")]);
  if (healthStatus !== 200) throw new Error(`component_runtime_health_status:${healthStatus}`);
  if (readyStatus !== 200) throw new Error(`component_runtime_ready_status:${readyStatus}`);
  return { transport: "UDS", healthStatus, readyStatus, checkedAt: new Date().toISOString() };
}
