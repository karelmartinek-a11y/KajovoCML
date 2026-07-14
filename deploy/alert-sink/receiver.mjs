import { createHmac, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import http from "node:http";

const port = Number(process.env.PORT);
const channel = process.env.ALERT_SINK_CHANNEL;
const stateDir = process.env.ALERT_SINK_STATE_DIR;
const keyFile = process.env.ALERT_SINK_HMAC_KEY_BASE64_FILE;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !["PRIMARY", "BACKUP"].includes(channel) || !stateDir || !keyFile) {
  throw new Error("alert_sink_configuration_invalid");
}
const key = Buffer.from((await readFile(keyFile, "utf8")).trim(), "base64");
if (key.length < 32) throw new Error("alert_sink_key_invalid");
await mkdir(stateDir, { recursive: true, mode: 0o700 });

async function removeExpiredDeliveries() {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1_000;
  for (const name of await readdir(stateDir)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const target = `${stateDir}/${name}`;
    if ((await stat(target)).mtimeMs < cutoff) await unlink(target);
  }
}
await removeExpiredDeliveries();
setInterval(() => void removeExpiredDeliveries().catch((error) => {
  console.error(JSON.stringify({ event: "kcml.alert.retention_failed", channel, error: error instanceof Error ? error.message : "unknown" }));
}), 24 * 60 * 60 * 1_000).unref();

function singleHeader(request, name) {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function validSignature(body, timestamp, signature) {
  if (!/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", key).update(`${timestamp}.${body}`).digest();
  const supplied = Buffer.from(signature.slice(3), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return send(response, 200, { status: "ok" });
  if (request.method !== "POST" || request.url !== "/kcml-alert") return send(response, 404, { error: "not_found" });
  const deliveryId = singleHeader(request, "x-kcml-delivery-id");
  const timestamp = singleHeader(request, "x-kcml-timestamp");
  const signature = singleHeader(request, "x-kcml-signature");
  if (!deliveryId || !/^[0-9a-f-]{36}$/.test(deliveryId) || !timestamp || !/^\d{10}$/.test(timestamp) || !signature) {
    return send(response, 401, { error: "invalid_signature_metadata" });
  }
  if (Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300) return send(response, 401, { error: "stale_signature" });

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) return send(response, 413, { error: "payload_too_large" });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!validSignature(body, timestamp, signature)) return send(response, 401, { error: "invalid_signature" });
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return send(response, 400, { error: "invalid_json" });
  }
  if (!payload || typeof payload.alertId !== "string" || typeof payload.correlationId !== "string") {
    return send(response, 400, { error: "invalid_alert" });
  }

  const target = `${stateDir}/${deliveryId}.json`;
  try {
    const file = await open(target, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try {
      await file.writeFile(JSON.stringify({ receivedAt: new Date().toISOString(), channel, deliveryId, payload }));
      await file.sync();
    } finally {
      await file.close();
    }
    console.log(JSON.stringify({ event: "kcml.alert.received", channel, deliveryId, alertId: payload.alertId, correlationId: payload.correlationId }));
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return send(response, 200, { ok: true, deliveryId });
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, "127.0.0.1");
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
