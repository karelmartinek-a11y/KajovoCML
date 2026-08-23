import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { authenticator } from "otplib";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../config.js";
import { loadBootstrapConfig } from "../config.js";
import { createDb } from "../db.js";
import { loadConfigFromDb } from "../domain/operational-config.js";
import { requireDeploymentManagedAdminPassword } from "../domain/deployment-managed-admin.js";
import { decryptMfaSecret } from "../security/secrets.js";

/**
 * The production acceptance runner is deliberately a release-time CLI.  It is
 * invoked only by an explicit workflow_dispatch input on the trusted
 * self-hosted runner.  PASS is consumed in memory for login and is never
 * copied into an artifact, a request log, a browser-visible field, or this
 * report.
 */

type JsonRecord = Record<string, unknown>;
type AcceptanceStatus = "PASS" | "FAIL";
type AcceptanceEvidence = { id: number; name: string; status: AcceptanceStatus; detail: string; elapsedMs: number };
type Session = { cookies: Map<string, string>; csrf: string; username: string };
type SseEvent = { id: number | null; type: string; data: JsonRecord };

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
] as const;

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
}

function safeDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(password|secret|token|api[_-]?key|ciphertext)\s*[:=]\s*[^,;\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetter.getSetCookie?.();
  if (values?.length) return values;
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function cookiePair(value: string): [string, string] | null {
  const first = value.split(";", 1)[0] ?? "";
  const separator = first.indexOf("=");
  if (separator < 1) return null;
  return [first.slice(0, separator), first.slice(separator + 1)];
}

class ProductionHttpClient {
  readonly cookies = new Map<string, string>();
  private csrfToken = "";
  constructor(readonly baseUrl: string, readonly host: string) {}

  authenticatedClone(): ProductionHttpClient {
    const clone = new ProductionHttpClient(this.baseUrl, this.host);
    for (const [name, value] of this.cookies) clone.cookies.set(name, value);
    clone.csrfToken = this.csrfToken;
    return clone;
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private absorb(response: Response): void {
    for (const cookie of getSetCookies(response.headers)) {
      const pair = cookiePair(cookie);
      if (!pair) continue;
      const [name, value] = pair;
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const csrf = this.cookies.get("__Host-kcml_csrf");
    if (csrf) this.csrfToken = csrf;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("host", this.host);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()) && this.csrfToken) headers.set("x-csrf-token", this.csrfToken);
    const response = await fetch(new URL(path, this.baseUrl), { ...init, headers });
    this.absorb(response);
    return response;
  }

  async json(path: string, init: RequestInit = {}, expected: number | number[] = 200): Promise<JsonRecord> {
    const response = await this.request(path, init);
    const body = await response.json().catch(() => ({})) as JsonRecord;
    const accepted = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
    if (!accepted) {
      const code = string(body.code) || `http_${response.status}`;
      throw new Error(`${code}:${response.status}`);
    }
    return body;
  }

  async login(username: string, password: string, totpSecret?: string): Promise<Session> {
    const first = await this.json("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    let final = first;
    if (first.mfaRequired === true) {
      if (!totpSecret) throw new Error("production_mfa_secret_unavailable_to_acceptance_runner");
      final = await this.json("/api/login/mfa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: authenticator.generate(totpSecret) })
      });
    }
    const csrf = string(final.csrfToken) || this.cookies.get("__Host-kcml_csrf") || "";
    if (final.ok !== true || !this.cookies.get("__Host-kcml_session") || !csrf || csrf !== this.cookies.get("__Host-kcml_csrf")) {
      throw new Error("production_login_cookie_contract_failed");
    }
    this.csrfToken = csrf;
    return { cookies: new Map(this.cookies), csrf, username };
  }

  async sse(path: string, lastEventId = 0, timeoutMs = 8_000): Promise<SseEvent[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers({ accept: "text/event-stream", host: this.host, "last-event-id": String(lastEventId) });
      const cookie = this.cookieHeader();
      if (cookie) headers.set("cookie", cookie);
      const response = await fetch(new URL(path, this.baseUrl), { headers, signal: controller.signal });
      this.absorb(response);
      if (!response.ok || !response.body) throw new Error(`sse_http_${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const events: SseEvent[] = [];
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = this.parseSseBlock(block);
          if (event) events.push(event);
          boundary = buffer.indexOf("\n\n");
        }
      }
      return events;
    } catch (error) {
      if (controller.signal.aborted) return [];
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseSseBlock(block: string): SseEvent | null {
    let id: number | null = null;
    let type = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/u)) {
      if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || null;
      else if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return null;
    try { return { id, type, data: object(JSON.parse(data.join("\n"))) }; }
    catch { throw new Error("sse_invalid_json_envelope"); }
  }
}

async function expectStatus(client: ProductionHttpClient, path: string, init: RequestInit, status: number): Promise<void> {
  const response = await client.request(path, init);
  if (response.status !== status) throw new Error(`expected_http_${status}_got_${response.status}`);
}

async function waitForJob(client: ProductionHttpClient, jobId: string, predicate: (job: JsonRecord) => boolean, timeoutMs = 300_000): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutMs;
  let last: JsonRecord = {};
  while (Date.now() < deadline) {
    const body = await client.json(`/api/generation/jobs/${jobId}`);
    last = object(body.job);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`generation_job_timeout:${string(last.state) || "unknown"}`);
}

async function waitForAutomationRun(client: ProductionHttpClient, runId: string, timeoutMs = 90_000): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutMs;
  let last: JsonRecord = {};
  while (Date.now() < deadline) {
    const body = await client.json(`/api/browser-automation-runs/${runId}`);
    last = object(body.run);
    if (["SUCCEEDED", "FAILED", "CANCELLED", "MANUAL_REVIEW", "DRIFT", "CHALLENGE_REQUIRED", "REAUTH_REQUIRED"].includes(string(last.status))) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`automation_run_timeout:${string(last.status) || "unknown"}`);
}

async function geometry(page: Page): Promise<{ horizontalOverflow: boolean; offscreen: number; clipped: number; focusable: boolean }> {
  return page.evaluate(() => {
    const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const actionable = Array.from(document.querySelectorAll<HTMLElement>("button,a,input,textarea,select,[tabindex]"))
      .filter((element) => element.offsetParent !== null && getComputedStyle(element).visibility !== "hidden");
    let offscreen = 0;
    let clipped = 0;
    for (const element of actionable) {
      const rect = element.getBoundingClientRect();
      if (rect.right > window.innerWidth + 2 || rect.left < -2 || rect.bottom < -2 || rect.top > window.innerHeight + 2) offscreen += 1;
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) clipped += 1;
    }
    const active = document.activeElement as HTMLElement | null;
    const focusRect = active?.getBoundingClientRect();
    const focusable = Boolean(active && focusRect && focusRect.width >= 1 && focusRect.height >= 1);
    return { horizontalOverflow, offscreen, clipped, focusable };
  });
}

async function browserUiAcceptance(context: BrowserContext, baseUrl: string): Promise<JsonRecord> {
  const page = await context.newPage();
  const pages = ["Dashboard", "Generování", "Browser automatizace", "Registrované prvky", "Katalog komponent", "Externí strany", "Monitoring komponent", "Tokeny a identity", "Secrets", "Správa oprávnění", "Audit", "Konfigurace", "Bezpečnost", "OWNER účty"];
  const geometryEvidence: Array<JsonRecord> = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    for (const label of pages) {
      const button = page.getByRole("button", { name: label, exact: true });
      if (await button.count() === 0) throw new Error(`ui_navigation_missing:${label}`);
      await button.click();
      await page.waitForTimeout(80);
      await page.keyboard.press("Tab");
      const result = await geometry(page);
      geometryEvidence.push({ viewport: `${viewport.width}x${viewport.height}`, page: label, ...result });
      if (result.horizontalOverflow || result.offscreen > 0 || !result.focusable) throw new Error(`ui_geometry_failed:${label}:${viewport.width}x${viewport.height}`);
    }
  }
  await page.close();
  return { viewports: VIEWPORTS.map((item) => `${item.width}x${item.height}`), pages: pages.length, samples: geometryEvidence.length };
}

function readOnlyManifest(baseDomain: string): JsonRecord {
  return {
    schemaVersion: "kcml.browser-automation.v1",
    steps: [
      { action: "NAVIGATE", url: `https://reference-api.${baseDomain}/ready`, sideEffectClass: "READ_ONLY" },
      { action: "ASSERT", predicate: { urlIncludes: "reference-api." }, sideEffectClass: "READ_ONLY" }
    ]
  };
}

async function cleanupAutomation(db: ReturnType<typeof createDb>, definitionId: string): Promise<void> {
  await db.query("update browser_automation_definition set active_revision_id=null where id=$1", [definitionId]).catch(() => undefined);
  await db.query("delete from browser_automation_run where definition_id=$1", [definitionId]).catch(() => undefined);
  await db.query("delete from browser_automation_auth_binding where definition_id=$1", [definitionId]).catch(() => undefined);
  await db.query("delete from browser_automation_revision where definition_id=$1", [definitionId]).catch(() => undefined);
  await db.query("delete from browser_automation_definition where id=$1", [definitionId]).catch(() => undefined);
}

async function cleanupDiscussion(db: ReturnType<typeof createDb>, config: AppConfig, jobId: string): Promise<void> {
  await db.query(
    `delete from generation_job
      where id=$1 and state in ('CANCELLED','FAILED','BLOCKED')
        and not exists (select 1 from generation_component where job_id=$1)`,
    [jobId]
  ).catch(() => undefined);
  const root = path.resolve(config.GENERATION_ROOT);
  const target = path.resolve(root, "generation-browser", jobId);
  if (target.startsWith(`${root}${path.sep}`)) await rm(target, { recursive: true, force: true }).catch(() => undefined);
}

async function resolveAcceptanceTotpSecret(db: ReturnType<typeof createDb>, config: AppConfig): Promise<string | undefined> {
  if (config.ADMIN_TOTP_SECRET?.trim()) return config.ADMIN_TOTP_SECRET.trim();
  const result = await db.query(
    "select id,mfa_enabled,mfa_secret from admin_account where username=$1 and active=true",
    [config.ADMIN_BOOTSTRAP_USERNAME]
  );
  const row = result.rows[0] as { id?: unknown; mfa_enabled?: unknown; mfa_secret?: unknown } | undefined;
  if (!row || row.mfa_enabled !== true || typeof row.mfa_secret !== "string" || !row.mfa_secret) return undefined;
  return decryptMfaSecret(row.mfa_secret, config.MFA_ENCRYPTION_KEY_BASE64, {
    allowLegacyPlaintext: config.MFA_ALLOW_PLAINTEXT_LEGACY,
    subjectId: String(row.id),
    purpose: "admin_totp"
  });
}

async function main(): Promise<void> {
  const baseUrl = process.env.KCML_ACCEPTANCE_BASE_URL ?? "";
  if (!/^https:\/\//u.test(baseUrl)) throw new Error("KCML_ACCEPTANCE_BASE_URL_must_be_https");
  const bootstrap = loadBootstrapConfig();
  const db = createDb(bootstrap);
  let config: AppConfig;
  try {
    config = await loadConfigFromDb(db, bootstrap);
    const password = requireDeploymentManagedAdminPassword(process.env.PASS);
    const totpSecret = await resolveAcceptanceTotpSecret(db, config);
    const client = new ProductionHttpClient(baseUrl, config.ADMIN_HOST);
    const evidence: AcceptanceEvidence[] = [];
    let sequence = 0;
    const createdJobs: string[] = [];
    const createdAutomations: string[] = [];
    const createdBrowserCredentialIds: string[] = [];
    const check = async (name: string, fn: () => Promise<string | JsonRecord | void>): Promise<void> => {
      const started = Date.now();
      sequence += 1;
      try {
        const value = await fn();
        const detail = typeof value === "string" ? value : value ? JSON.stringify(value) : "ok";
        evidence.push({ id: sequence, name, status: "PASS", detail: detail.slice(0, 500), elapsedMs: Date.now() - started });
      } catch (error) {
        evidence.push({ id: sequence, name, status: "FAIL", detail: safeDetail(error), elapsedMs: Date.now() - started });
      }
    };

    await check("public health", async () => {
      const response = await fetch(new URL("/health", baseUrl), { headers: { host: config.ADMIN_HOST } });
      if (!response.ok) throw new Error(`health_http_${response.status}`);
      return "health=200";
    });
    await check("unauthenticated session boundary", async () => {
      const anonymous = new ProductionHttpClient(baseUrl, config.ADMIN_HOST);
      const body = await anonymous.json("/api/session");
      if (body.authenticated !== false) throw new Error("anonymous_session_not_anonymous");
      return "authenticated=false";
    });
    await check("deployment-managed OWNER login and CSRF", async () => {
      const session = await client.login(config.ADMIN_BOOTSTRAP_USERNAME, password, totpSecret);
      if (!session.csrf) throw new Error("csrf_missing");
      return { username: session.username, csrfContract: true };
    });
    await check("single OWNER session role", async () => {
      const body = await client.json("/api/session");
      if (body.authenticated !== true || body.role !== "OWNER") throw new Error("owner_session_contract_failed");
      return { role: body.role };
    });
    await check("admin security exposes no second human role", async () => {
      const body = await client.json("/api/admin-security");
      if (body.role !== "OWNER") throw new Error("admin_security_owner_role_missing");
      return { role: body.role, mfaEnabled: Boolean(body.mfaEnabled) };
    });
    await check("canonical OWNER read surfaces and safe metadata boundary", async () => {
      const paths = [
        "/api/admin-accounts", "/api/operational-config", "/api/secrets", "/api/components",
        "/api/external-principals", "/api/external-targets", "/api/external-permissions",
        "/api/mcp-servers", "/api/managed-services", "/api/kaja", "/api/audit?limit=1",
        "/api/monitoring-overview", "/api/readiness", "/api/generation/jobs", "/api/browser-automations"
      ];
      const statuses: Record<string, number> = {};
      for (const path of paths) {
        const response = await client.request(path);
        statuses[path] = response.status;
        if (response.status !== 200) throw new Error(`owner_read_surface_http_${path.replace(/[^a-z0-9]+/giu, "_")}_${response.status}`);
        const body = await response.text();
        if (/encrypted_value|ciphertext|authorization\s*:\s*bearer|-----BEGIN/iu.test(body)) throw new Error("owner_read_surface_secret_leak");
      }
      return { routeCount: paths.length, statuses };
    });
    await check("human role mutation is rejected without creating another role", async () => {
      const response = await client.request("/api/admin-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: `ssot-role-probe-${randomUUID().slice(0, 8)}`, password: "invalid-probe-password-never-used", role: "ADMIN" })
      });
      if (response.status !== 400) throw new Error(`role_mutation_probe_http_${response.status}`);
      return { status: response.status, roleMutation: "rejected" };
    });
    await check("mutation requires CSRF", async () => {
      const response = await client.request("/api/generation/jobs", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "" }, body: JSON.stringify({ prompt: "invalid csrf probe" }) });
      if (response.status !== 403) throw new Error(`csrf_probe_http_${response.status}`);
      return "csrf=403";
    });
    await check("authenticated generation setup reuses existing provider", async () => {
      const body = await client.json("/api/generation/setup");
      if (body.openAiReady !== true) throw new Error("openai_not_ready");
      return { openAiReady: true };
    });

    const prompt = [
      "Vytvoř bezpečný read-only testovací generation job pro KájovoCML.",
      "Cílem je pouze ověřit diskusi, capability-first lookup, immutable GenerationSpecification a schválený planner path.",
      "Požadovaný výsledek je minimální MCP_SERVER bez destruktivních akcí, bez autentizace, bez webhooků a bez změn externích dat.",
      `Použij bezpečný reference-api readiness fixture https://reference-api.${config.PUBLIC_BASE_DOMAIN}/ready, pokud je to vhodné; žádný produkční write, žádný secret a žádný OWNER follow-up není potřeba.`,
      "Rozhodnutí OWNER: testovací artefakt smí být po acceptance deaktivován; neprováděj nevratné operace."
    ].join(" ");
    let jobId = "";
    let streamEvents: SseEvent[] = [];
    await check("generation job starts in DISCUSSING", async () => {
      const body = await client.json("/api/generation/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, clientRequestId: `ssot-${randomUUID()}` }) }, [201, 200]);
      const job = object(body.job); jobId = string(job.id); if (!jobId || job.state !== "DISCUSSING") throw new Error("generation_not_discussing");
      createdJobs.push(jobId);
      return { jobId, state: job.state };
    });
    if (jobId) {
      await check("persistent OWNER message history", async () => {
        const body = await client.json(`/api/generation/jobs/${jobId}/messages`);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (!messages.some((message) => object(message).role === "OWNER")) throw new Error("owner_message_missing");
        return { messageCount: messages.length };
      });
      await check("generation browser preview session and sensitive boundary", async () => {
        const initial = await client.request(`/api/generation/jobs/${jobId}/browser/preview`);
        if (initial.status !== 200) throw new Error(`browser_preview_no_frame_http_${initial.status}`);
        const initialBody = await initial.json().catch(() => ({})) as JsonRecord;
        if (string(initialBody.status) !== "NO_PREVIEW") throw new Error("browser_preview_initial_state_invalid");
        const open = await client.json(`/api/generation/jobs/${jobId}/browser/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `https://reference-api.${config.PUBLIC_BASE_DOMAIN}/ready` }) });
        const frame = object(open.preview);
        if (string(frame.status) !== "NORMAL" || !string(frame.frameId) || Number(frame.revision) < 1) throw new Error("browser_preview_frame_missing");
        const normal = await client.request(`/api/generation/jobs/${jobId}/browser/preview`);
        if (normal.status !== 200 || !/image\/png/iu.test(normal.headers.get("content-type") ?? "") || !/no-store/iu.test(normal.headers.get("cache-control") ?? "")) throw new Error(`browser_preview_image_http_${normal.status}`);
        if ((await normal.arrayBuffer()).byteLength < 100) throw new Error("browser_preview_image_empty");
        await client.json(`/api/generation/jobs/${jobId}/browser/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `https://reference-api.${config.PUBLIC_BASE_DOMAIN}/ready`, sensitive: true }) });
        const sensitive = await client.request(`/api/generation/jobs/${jobId}/browser/preview`);
        if (sensitive.status !== 423) throw new Error(`browser_preview_sensitive_http_${sensitive.status}`);
        const sensitiveBody = await sensitive.text();
        if (/-----BEGIN|Bearer\s|sk-[A-Za-z0-9_-]+/iu.test(sensitiveBody)) throw new Error("browser_preview_sensitive_leak");
        await client.json(`/api/generation/jobs/${jobId}/browser/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `https://reference-api.${config.PUBLIC_BASE_DOMAIN}/ready` }) });
        const restored = await client.request(`/api/generation/jobs/${jobId}/browser/preview`);
        if (restored.status !== 200 || !/image\/png/iu.test(restored.headers.get("content-type") ?? "")) throw new Error("browser_preview_normal_restore_failed");
        return { initial: "NO_PREVIEW", normalFrame: string(frame.frameId), sensitive: "HIDDEN", restored: "NORMAL" };
      });
      await check("operation scope and irreversible confirmation boundary", async () => {
        const messages = await client.json(`/api/generation/jobs/${jobId}/messages`);
        const ownerMessage = (Array.isArray(messages.messages) ? messages.messages : []).find((message) => object(message).role === "OWNER");
        if (!string(object(ownerMessage).id)) throw new Error("scope_owner_message_missing");
        const scope = await client.json(`/api/generation/jobs/${jobId}/browser/operation-scope`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceMessageId: string(object(ownerMessage).id), purpose: "Readiness fixture inspection", allowedOrigins: [`https://reference-api.${config.PUBLIC_BASE_DOMAIN}`], allowedActionClasses: ["READ_ONLY"] }) }, 201);
        if (!string(object(scope.scope).scopeDigest)) throw new Error("scope_digest_missing");
        const outside = await client.request(`/api/generation/jobs/${jobId}/browser/irreversible-confirmations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopeId: string(object(scope.scope).id), sourceMessageId: string(object(ownerMessage).id), actionDigest: sha256("out-of-scope-action"), actionSummary: "Attempted mutation outside explicit read-only scope", targetOrigin: `https://reference-api.${config.PUBLIC_BASE_DOMAIN}` }) });
        if (outside.status !== 409) throw new Error(`scope_confirmation_boundary_http_${outside.status}`);
        return { scope: "ACTIVE", actionClasses: ["READ_ONLY"], outOfScopeConfirmation: "REJECTED" };
      });
      await check("browser credential field uses Secret Manager metadata only", async () => {
        const stableName = `SSOT_BROWSER_${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
        const body = await client.json(`/api/generation/jobs/${jobId}/browser/credentials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stableName, value: `acceptance-${randomUUID()}`, displayName: "Temporary acceptance browser credential" }) }, 201);
        const credential = object(body.credential);
        const secretId = string(credential.secretId);
        if (!secretId || !string(credential.activeVersionId) || !string(credential.platformPrincipal)) throw new Error("browser_credential_metadata_missing");
        createdBrowserCredentialIds.push(secretId);
        const responseText = JSON.stringify(body);
        if (/acceptance-|-----BEGIN|Bearer\s|sk-[A-Za-z0-9_-]+/iu.test(responseText)) throw new Error("browser_credential_value_leak");
        return { stableName, secretId, platformPrincipal: string(credential.platformPrincipal), value: "REDACTED" };
      });
      await check("teaching preflight and deterministic replay persist semantic steps", async () => {
        const fixtureManifest = readOnlyManifest(config.PUBLIC_BASE_DOMAIN);
        const preflight = await client.json(`/api/generation/jobs/${jobId}/browser/teaching/preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: fixtureManifest, purpose: "Read-only readiness teaching preflight" }) });
        const replay = await client.json(`/api/generation/jobs/${jobId}/browser/teaching/replay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: fixtureManifest, purpose: "Deterministic readiness replay" }) });
        if (string(object(preflight.preflight).status) !== "PASS" || string(object(replay.replay).status) !== "PASS") throw new Error("teaching_replay_not_pass");
        if (Number(object(preflight.preflight).modelCalls) !== 0 || Number(object(replay.replay).modelCalls) !== 0) throw new Error("teaching_replay_used_model");
        const teaching = await client.json(`/api/generation/jobs/${jobId}/browser/teaching`);
        const runs = Array.isArray(teaching.teaching) ? teaching.teaching : [];
        if (runs.length < 2 || !runs.every((run) => Array.isArray(object(run).steps) && (object(run).steps as unknown[]).length > 0)) throw new Error("teaching_steps_not_persisted");
        return { preflight: string(object(preflight.preflight).teachingRunId), replay: string(object(replay.replay).teachingRunId), runs: runs.length, modelCalls: 0 };
      });
      await check("reload and second client see authoritative job history", async () => {
        const secondClient = client.authenticatedClone();
        const [firstJob, secondJob, firstMessages, secondMessages] = await Promise.all([
          client.json(`/api/generation/jobs/${jobId}`),
          secondClient.json(`/api/generation/jobs/${jobId}`),
          client.json(`/api/generation/jobs/${jobId}/messages?limit=1`),
          secondClient.json(`/api/generation/jobs/${jobId}/messages?limit=1`)
        ]);
        const first = object(firstJob.job); const second = object(secondJob.job);
        const firstPage = Array.isArray(firstMessages.messages) ? firstMessages.messages : [];
        const secondPage = Array.isArray(secondMessages.messages) ? secondMessages.messages : [];
        if (string(first.id) !== jobId || string(second.id) !== jobId || string(first.state) !== string(second.state)) throw new Error("multi_client_job_state_mismatch");
        if (firstPage.length !== secondPage.length || string(object(firstPage[0]).id) !== string(object(secondPage[0]).id)) throw new Error("multi_client_history_mismatch");
        return { state: string(first.state), firstClientMessages: firstPage.length, secondClientMessages: secondPage.length, paginationCursor: firstMessages.nextBefore ?? null };
      });
      await check("SSE bootstrap and replay envelope", async () => {
        streamEvents = await client.sse(`/api/generation/jobs/${jobId}/events`, 0);
        if (!streamEvents.some((event) => event.type === "generation.created" || event.type === "generation.state.changed")) throw new Error("sse_bootstrap_event_missing");
        const ids = streamEvents.map((event) => event.id).filter((id): id is number => id !== null);
        if (ids.some((id, index) => {
          const previous = index > 0 ? ids[index - 1] : undefined;
          return previous !== undefined && id <= previous;
        })) throw new Error("sse_event_ids_not_monotonic");
        return { eventCount: streamEvents.length, lastEventId: ids.at(-1) ?? 0 };
      });
      const lastEventId = streamEvents.map((event) => event.id).filter((id): id is number => id !== null).at(-1) ?? 0;
      await check("SSE Last-Event-ID reconnect has no duplicate cursor", async () => {
        const replay = await client.sse(`/api/generation/jobs/${jobId}/events`, lastEventId);
        if (replay.some((event) => event.id !== null && event.id <= lastEventId)) throw new Error("sse_replayed_old_event");
        return { replayEvents: replay.length, after: lastEventId };
      });
      await check("Responses discussion and capability-first evidence", async () => {
        const job = await waitForJob(client, jobId, (candidate) => Boolean(candidate.currentSpecRevisionId) || ["BLOCKED", "FAILED", "CANCELLED"].includes(string(candidate.state)), 300_000);
        const events = await db.query("select type,payload,sequence from generation_event where job_id=$1 order by sequence", [jobId]);
        const toolEvents = events.rows.filter((row) => ["discussion.tool.started", "discussion.tool.completed"].includes(String(row.type)));
        const hasLookup = toolEvents.some((row) => object(row.payload).toolName === "lookup_cml_capabilities");
        const hasContract = toolEvents.some((row) => object(row.payload).toolName === "read_cml_capability_contract");
        const hasProposal = toolEvents.some((row) => object(row.payload).toolName === "propose_generation_specification");
        if (!hasLookup || !hasProposal) throw new Error(`capability_first_evidence_missing:lookup=${hasLookup}:proposal=${hasProposal}`);
        const messages = await client.json(`/api/generation/jobs/${jobId}/messages`);
        const assistant = (Array.isArray(messages.messages) ? messages.messages : []).filter((message) => object(message).role === "ASSISTANT");
        if (!assistant.length || assistant.some((message) => /function_call_output|browserAutomations|capabilityDecisions.*componentId/iu.test(string(object(message).content)))) throw new Error("visible_tool_or_spec_json");
        const replay = await client.sse(`/api/generation/jobs/${jobId}/events`, 0, 30_000);
        const deltas = replay.filter((event) => event.type === "discussion.message.delta");
        if (!deltas.length) throw new Error("assistant_delta_event_missing");
        const paged = await client.json(`/api/generation/jobs/${jobId}/messages?limit=1`);
        const nextBefore = Number(paged.nextBefore ?? 0);
        if (nextBefore > 0) {
          const older = await client.json(`/api/generation/jobs/${jobId}/messages?before=${nextBefore}&limit=1`);
          const newest = object((Array.isArray(paged.messages) ? paged.messages : [])[0]);
          const previous = object((Array.isArray(older.messages) ? older.messages : [])[0]);
          if (!newest.sequence || !previous.sequence || Number(previous.sequence) >= Number(newest.sequence)) throw new Error("message_pagination_order_failed");
        }
        return { state: string(job.state), currentSpec: Boolean(job.currentSpecRevisionId), lookup: hasLookup, contractInspection: hasContract, proposal: hasProposal, assistantMessages: assistant.length, assistantDeltas: deltas.length, pagination: nextBefore > 0 };
      });
      await check("stale approval is rejected", async () => {
        const specBody = await client.json(`/api/generation/jobs/${jobId}/spec`);
        const spec = object(specBody.spec);
        if (!string(spec.id) || !string(spec.digest)) throw new Error("spec_not_available_for_stale_probe");
        const response = await client.request(`/api/generation/jobs/${jobId}/approve-spec`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: spec.id, digest: sha256("stale-acceptance-digest") }) });
        if (response.status !== 409) throw new Error(`stale_approval_http_${response.status}`);
        return { status: response.status };
      });
      let approvalCreated = false;
      await check("correct approval freezes exact reusable specification", async () => {
        const specBody = await client.json(`/api/generation/jobs/${jobId}/spec`);
        const spec = object(specBody.spec); const typed = object(spec.spec);
        const decisions = Array.isArray(typed.capabilityDecisions) ? typed.capabilityDecisions : [];
        const canApproveWithoutCreatingFixture = decisions.some((decision) => {
          const value = object(decision);
          return ["FULL_REUSE", "PARTIAL_REUSE"].includes(string(value.decision)) && Array.isArray(value.reuse) && value.reuse.length > 0;
        });
        if (typed.openQuestions && Array.isArray(typed.openQuestions) && typed.openQuestions.length > 0) throw new Error("acceptance_spec_open_questions");
        if (!canApproveWithoutCreatingFixture) return { approval: "not-run-no-reusable-capability" };
        const response = await client.request(`/api/generation/jobs/${jobId}/approve-spec`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: string(spec.id), digest: string(spec.digest) }) });
        const body = await response.json().catch(() => ({})) as JsonRecord;
        if (response.status !== 200 || !object(body.approval).revisionId) throw new Error(`approval_http_${response.status}`);
        approvalCreated = true;
        const approvedJob = await client.json(`/api/generation/jobs/${jobId}`);
        if (!["ANALYZING", "IMPLEMENTING", "INTEGRATING", "VALIDATING", "CML_CONFORMANCE", "ACTIVATING", "COMPLETED", "CANCELLED"].includes(string(object(approvedJob.job).state))) throw new Error("approval_state_not_advanced");
        return { approval: "PASS", state: string(object(approvedJob.job).state), digest: string(spec.digest) };
      });
      await check("generation cancellation is idempotent", async () => {
        let cancellationJobId = jobId;
        if (approvalCreated) {
          const replacement = await client.json("/api/generation/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, clientRequestId: `ssot-cancel-${randomUUID()}` }) }, [201, 200]);
          cancellationJobId = string(object(replacement.job).id);
          if (!cancellationJobId || string(object(replacement.job).state) !== "DISCUSSING") throw new Error("cancellation_fixture_not_discussing");
          createdJobs.push(cancellationJobId);
        }
        const current = await client.json(`/api/generation/jobs/${cancellationJobId}`);
        if (string(object(current.job).state) !== "CANCELLED") {
          await client.json(`/api/generation/jobs/${cancellationJobId}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, [200, 202]);
          await client.json(`/api/generation/jobs/${cancellationJobId}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, [200, 202, 409]);
        }
        const job = await waitForJob(client, cancellationJobId, (candidate) => string(candidate.state) === "CANCELLED", 30_000);
        return { state: job.state, isolatedFixture: approvalCreated };
      });
    }

    let definitionId = "";
    let automationRunId = "";
    await check("canonical Browser Automation definition and immutable revision", async () => {
      const code = `ssot-accept-${randomUUID().slice(0, 8)}`;
      const definition = await client.json("/api/browser-automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, displayName: "SSOT acceptance read-only fixture", purpose: "Temporary production acceptance fixture" }) }, 201);
      definitionId = string(definition.definitionId); if (!definitionId) throw new Error("automation_definition_missing");
      createdAutomations.push(definitionId);
      const revision = await client.json(`/api/browser-automations/${definitionId}/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: readOnlyManifest(config.PUBLIC_BASE_DOMAIN) }) }, 201);
      const revisionView = object(revision.revision);
      if (!string(revisionView.id) || !/^sha256:[0-9a-f]{64}$/u.test(string(revisionView.digest))) throw new Error("automation_revision_digest_missing");
      return { definitionId, revisionId: string(revisionView.id), digest: string(revisionView.digest) };
    });
    if (definitionId) {
      let revisionId = "";
      await check("Playwright preflight and runtime verification", async () => {
        const revisions = await client.json(`/api/browser-automations/${definitionId}/revisions`);
        const revision = object((Array.isArray(revisions.revisions) ? revisions.revisions : [])[0]); revisionId = string(revision.id);
        if (!revisionId) throw new Error("automation_revision_not_listed");
        const verification = await client.json(`/api/browser-automations/${definitionId}/revisions/${revisionId}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: {} }) });
        if (object(verification.verification).verificationStatus !== "PASS") throw new Error("automation_runtime_verification_failed");
        await client.json(`/api/browser-automations/${definitionId}/revisions/${revisionId}/activate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const preflight = await client.json(`/api/browser-automations/${definitionId}/preflight`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        if (object(preflight.preflight).verificationStatus !== "STATIC_VALIDATED") throw new Error("automation_static_preflight_contract_failed");
        return { revisionId, verification: "PASS", preflight: "STATIC_VALIDATED" };
      });
      await check("automation enable, idempotency and routine run without LLM", async () => {
        await client.json(`/api/browser-automations/${definitionId}/enable`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const key = `ssot-${randomUUID()}`;
        const queued = await client.json(`/api/browser-automations/${definitionId}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: {}, idempotencyKey: key }) }, 202);
        automationRunId = string(object(queued.run).id); if (!automationRunId) throw new Error("automation_run_missing");
        const replay = await client.json(`/api/browser-automations/${definitionId}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: {}, idempotencyKey: key }) }, [200, 202]);
        if (string(object(replay.run).id) !== automationRunId) throw new Error("automation_idempotency_failed");
        const run = await waitForAutomationRun(client, automationRunId);
        if (run.status !== "SUCCEEDED") throw new Error(`automation_status_${string(run.status)}`);
        await client.json(`/api/browser-automations/${definitionId}/disable`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        await expectStatus(client, `/api/browser-automations/${definitionId}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: {}, idempotencyKey: `disabled-${randomUUID()}` }) }, 409);
        return { runId: automationRunId, status: run.status, idempotentReplay: true, disabledBlocksRuns: true };
      });
      await check("automation history and protected evidence are scoped and safe", async () => {
        const history = await client.json(`/api/browser-automations/${definitionId}/runs`);
        const listed = (Array.isArray(history.runs) ? history.runs : []).find((item) => string(object(item).id) === automationRunId);
        if (!listed) throw new Error("automation_run_history_missing");
        const detail = await client.json(`/api/browser-automation-runs/${automationRunId}`);
        if (string(object(detail.run).status) !== "SUCCEEDED") throw new Error("automation_run_detail_status_mismatch");
        const artifacts = await db.query("select id,kind,storage_key,sensitive,content_type from browser_automation_artifact where run_id=$1 order by created_at", [automationRunId]);
        const artifact = artifacts.rows.find((row) => String(row.kind) === "EVIDENCE");
        if (!artifact || Boolean(artifact.sensitive) || String(artifact.storage_key).startsWith("/")) throw new Error("automation_evidence_contract_failed");
        const artifactResponse = await client.request(`/api/browser-automation-runs/${automationRunId}/artifacts/${String(artifact.id)}`);
        if (artifactResponse.status !== 200 || !/private/iu.test(artifactResponse.headers.get("cache-control") ?? "") || !/no-store/iu.test(artifactResponse.headers.get("cache-control") ?? "")) throw new Error(`automation_artifact_http_${artifactResponse.status}`);
        const artifactBody = await artifactResponse.text();
        if (!artifactBody.includes(automationRunId) || /-----BEGIN|Bearer\s|sk-[A-Za-z0-9_-]+/iu.test(artifactBody)) throw new Error("automation_artifact_content_unsafe");
        const crossRun = await client.request(`/api/browser-automation-runs/${automationRunId}/artifacts/${randomUUID()}`);
        if (crossRun.status !== 404) throw new Error(`automation_artifact_scope_http_${crossRun.status}`);
        return { runId: automationRunId, history: "PASS", evidenceArtifacts: artifacts.rows.length, protectedDownload: "PASS" };
      });
      await check("automation repair route fails closed without component lineage", async () => {
        const response = await client.json(`/api/browser-automations/${definitionId}/repair`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const repair = object(response.repair);
        if (string(repair.repairAction) !== "BLOCKED" || !string(repair.blockerCode)) throw new Error("automation_repair_not_blocked_without_lineage");
        return { repairAction: repair.repairAction, blocker: repair.blockerCode };
      });
    }

    await check("authenticated OWNER browser UI geometry and navigation", async () => {
      const browser = await chromium.launch({ headless: true, executablePath: config.CHROMIUM_BINARY || undefined });
      try {
        const context = await browser.newContext();
        for (const [name, value] of client.cookies) await context.addCookies([{ name, value, url: baseUrl, httpOnly: name.includes("session"), secure: true, sameSite: "Strict" }]);
        const result = await browserUiAcceptance(context, baseUrl);
        await context.close();
        return result;
      } finally { await browser.close(); }
    });

    await check("safe production acceptance cleanup", async () => {
      for (const id of createdAutomations) await cleanupAutomation(db, id);
      for (const id of createdBrowserCredentialIds) {
        await db.query("update secret_grant set revoked_at=coalesce(revoked_at,now()) where secret_id=$1", [id]);
        await db.query("update secret_record set status='DELETED',deleted_at=coalesce(deleted_at,now()),active_version_id=null where id=$1", [id]);
      }
      for (const id of createdJobs) await cleanupDiscussion(db, config, id);
      return { automationFixtures: createdAutomations.length, browserCredentialFixtures: createdBrowserCredentialIds.length, discussionFixtures: createdJobs.length, cleanup: "attempted" };
    });

    const failed = evidence.filter((item) => item.status === "FAIL");
    const report = {
      schemaVersion: "kcml.ssot.production-acceptance.v1",
      productionHost: config.ADMIN_HOST,
      buildId: config.BUILD_ID,
      schemaMigration: (await db.query("select max(version) as version,count(*)::int as count from schema_migration")).rows[0]?.version ?? "unknown",
      evidence,
      passCount: evidence.length - failed.length,
      failCount: failed.length,
      createdFixtureCount: createdAutomations.length + createdJobs.length,
      safeIdentifiersOnly: true
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

await main();
