import { request as httpsRequest } from "node:https";

export const EXTERNAL_HTTP_METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization",
  "proxy-authenticate", "authorization", "cookie", "set-cookie", "te", "trailer"
]);

export function normalizeExternalMethod(value, allowedMethods = EXTERNAL_HTTP_METHODS) {
  const method = String(value || "POST").toUpperCase();
  if (!EXTERNAL_HTTP_METHODS.includes(method)) throw new Error("external_http_method_invalid");
  const allowed = Array.from(allowedMethods || []).map((item) => String(item).toUpperCase());
  if (!allowed.includes(method)) throw Object.assign(new Error("external_method_denied"), { statusCode: 403 });
  return method;
}

export function normalizeExternalRoute(value) {
  const raw = String(value || "");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("#") || /[\r\n]/.test(raw)) throw new Error("external_route_path_invalid");
  const url = new URL(raw, "https://kcml.invalid");
  if (url.origin !== "https://kcml.invalid") throw new Error("external_route_path_invalid");
  return { pathname: url.pathname, search: url.search, pathAndQuery: `${url.pathname}${url.search}` };
}

export function normalizeExternalHeaders(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("external_headers_invalid");
  const output = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = String(rawName).toLowerCase();
    const value = String(rawValue);
    if (!/^[a-z0-9-]{1,80}$/.test(name) || FORBIDDEN_REQUEST_HEADERS.has(name) || name.startsWith("x-kcml-")) throw new Error(`external_header_denied:${name}`);
    if (value.length > 8192 || /[\r\n]/.test(value)) throw new Error(`external_header_value_invalid:${name}`);
    output[name] = value;
  }
  return output;
}

export function encodeExternalBody({ method = "POST", bodyType, body, payload }) {
  const normalizedMethod = String(method).toUpperCase();
  const resolvedType = String(bodyType || (payload !== undefined ? "JSON" : body !== undefined ? "JSON" : "NONE")).toUpperCase();
  if (!new Set(["NONE", "JSON", "FORM", "TEXT"]).has(resolvedType)) throw new Error("external_body_type_invalid");
  if (normalizedMethod === "HEAD" || resolvedType === "NONE") return { bodyType: "NONE", body: undefined, contentType: null };
  const value = body !== undefined ? body : payload;
  if (resolvedType === "JSON") return { bodyType: "JSON", body: Buffer.from(JSON.stringify(value ?? {})), contentType: "application/json" };
  if (resolvedType === "FORM") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("external_form_body_invalid");
    const form = new URLSearchParams();
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item)) for (const nested of item) form.append(key, String(nested));
      else if (item !== undefined && item !== null) form.append(key, String(item));
    }
    return { bodyType: "FORM", body: Buffer.from(form.toString()), contentType: "application/x-www-form-urlencoded" };
  }
  if (typeof value !== "string" && !Buffer.isBuffer(value)) throw new Error("external_text_body_invalid");
  return { bodyType: "TEXT", body: Buffer.isBuffer(value) ? value : Buffer.from(value), contentType: "text/plain; charset=utf-8" };
}

export async function applyExternalProviderAuth({ authConfig = {}, accessToken, tokenFingerprint, correlationId, resolveSecret }) {
  const mode = String(authConfig?.mode ?? "FORWARD_KCML_BEARER");
  const headers = { "x-kcml-correlation-id": String(correlationId) };
  if (mode === "FORWARD_KCML_BEARER") {
    headers.authorization = `Bearer ${accessToken}`;
    headers["x-kcml-access-token-fingerprint"] = String(tokenFingerprint);
    return { headers, authMode: mode, providerSecretFingerprint: null };
  }
  if (mode === "NONE") return { headers, authMode: mode, providerSecretFingerprint: null };
  if (mode !== "BEARER_SECRET" && mode !== "HEADER_SECRET") throw new Error("external_provider_auth_mode_invalid");
  const stableName = String(authConfig.secretName ?? "");
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(stableName)) throw new Error("external_provider_secret_name_invalid");
  const secret = await resolveSecret(stableName);
  if (mode === "BEARER_SECRET") headers.authorization = `Bearer ${secret.value}`;
  else {
    const headerName = String(authConfig.headerName ?? "").toLowerCase();
    if (!/^[a-z0-9-]{2,80}$/.test(headerName) || FORBIDDEN_REQUEST_HEADERS.has(headerName) || headerName.startsWith("x-kcml-")) throw new Error("external_provider_header_invalid");
    headers[headerName] = `${String(authConfig.prefix ?? "")}${secret.value}`;
  }
  return { headers, authMode: mode, providerSecretFingerprint: secret.fingerprint ?? null };
}

export function externalRouteAllowed(routePattern, pathname) {
  const pattern = String(routePattern || "");
  const path = String(pathname || "");
  if (pattern === path) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return false;
}

export function performPinnedHttpsRequest({ url, method, headers = {}, body, timeoutMs, address, family, ca }) {
  const target = url instanceof URL ? url : new URL(String(url));
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders["content-length"] = String(Buffer.byteLength(body));
    const request = httpsRequest({
      protocol: "https:", hostname: target.hostname, servername: target.hostname, port: Number(target.port || 443),
      method, path: `${target.pathname}${target.search}`, headers: requestHeaders,
      rejectUnauthorized: true, ca, timeout: timeoutMs,
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family)
    }, (response) => {
      const chunks = []; let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) request.destroy(new Error("external_gateway_response_too_large"));
        else chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const responseHeaders = {};
        for (const [key, value] of Object.entries(response.headers)) {
          if (value === undefined) continue;
          responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
        }
        resolve({ statusCode: response.statusCode ?? 502, headers: responseHeaders, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.on("timeout", () => request.destroy(new Error("external_gateway_timeout")));
    request.on("error", reject);
    if (body === undefined) request.end(); else request.end(body);
  });
}
