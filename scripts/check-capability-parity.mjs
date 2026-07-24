import fs from "node:fs";

const matrixPath = new URL("../docs/dashboard/capability-parity.json", import.meta.url);
const routesPath = new URL("../apps/server/src/http/dashboard-routes.ts", import.meta.url);
const apiPath = new URL("../apps/admin-ui/src/server-api.ts", import.meta.url);
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
const routes = fs.readFileSync(routesPath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");
const allowed = new Set([
  "COVERED_STANDARD_AND_DASHBOARD", "COVERED_STANDARD_ONLY_WITH_JUSTIFICATION", "OBSERVABILITY_ONLY",
  "SYSTEM_INTERNAL_NO_OPERATOR_UI", "BOOTSTRAP_ONLY", "MISSING_UI", "ORPHAN_UI",
  "DUPLICATE_OR_CONFLICTING_UI", "MISSING_BACKEND", "UNVERIFIED"
]);
const blocking = new Set(["MISSING_UI", "ORPHAN_UI", "DUPLICATE_OR_CONFLICTING_UI", "MISSING_BACKEND", "UNVERIFIED"]);
const required = ["capabilityId","domain","backendRouteOrOperation","domainFunction","authoritativeSource","authorization","sideEffect","auditEvent","standardUi","dashboardUi","ownerAvailable","testId","evidenceId","parityStatus"];
const ids = new Set();
const declaredRoutes = new Set();
for (const item of matrix.capabilities ?? []) {
  for (const field of required) if (item[field] === undefined || item[field] === "") throw new Error(`parity_missing_field:${item.capabilityId ?? "unknown"}:${field}`);
  if (ids.has(item.capabilityId)) throw new Error(`parity_duplicate_id:${item.capabilityId}`);
  ids.add(item.capabilityId);
  if (!allowed.has(item.parityStatus)) throw new Error(`parity_invalid_status:${item.capabilityId}:${item.parityStatus}`);
  if (blocking.has(item.parityStatus)) throw new Error(`parity_blocking_status:${item.capabilityId}:${item.parityStatus}`);
  const routeMatch = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/dashboard\/\S+)/.exec(item.backendRouteOrOperation);
  if (routeMatch) declaredRoutes.add(`${routeMatch[1]} ${routeMatch[2]}`);
}
const routeMatches = [...routes.matchAll(/app\.(get|post|put|patch|delete)\("(\/api\/dashboard\/[^"?]+)"/g)]
  .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
for (const route of routeMatches) if (!declaredRoutes.has(route)) throw new Error(`dashboard_route_missing_from_parity:${route}`);
const clientFunctions = [...api.matchAll(/export async function ([A-Za-z0-9]*Dashboard[A-Za-z0-9]*)/g)].map((match) => match[1]);
for (const name of clientFunctions) {
  const represented = matrix.capabilities.some((item) => item.domainFunction === name || item.dashboardUi.toLowerCase().includes("dashboard") || item.backendRouteOrOperation.includes("existing Secret reveal API"));
  if (!represented) throw new Error(`dashboard_client_action_missing_from_parity:${name}`);
}
console.log(`Dashboard capability parity: PASS (${ids.size} capabilities, ${routeMatches.length} routes).`);
