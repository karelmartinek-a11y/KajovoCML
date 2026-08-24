import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { GenerationPlan } from "../domain/generation.js";
import { PlaywrightBrowserSession as BrowserSession } from "./playwright-session.mjs";
import { captureProviderBrowserSecret, captureProviderJsonSecrets } from "./provider-secret-capability.mjs";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_MODEL_TURNS = 40;

export type ResponsesStreamEvent = Record<string, unknown>;

function stringArg(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function objectArg(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseObjectJson(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = JSON.parse(value) as unknown;
  return objectArg(parsed) ?? fallback;
}

async function responseRequest(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`openai_responses_${response.status}:${JSON.stringify(payload).slice(0, 1200)}`);
  return payload;
}

function parseResponseSseBlock(block: string): ResponsesStreamEvent | null {
  const data = block.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try { return JSON.parse(data) as ResponsesStreamEvent; }
  catch { return null; }
}

/** Shared Responses streaming transport used by all model tool loops. */
export async function* streamResponse(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<ResponsesStreamEvent> {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000)
  });
  if (!response.ok || !response.body) {
    const payload = await response.text();
    throw new Error(`openai_responses_${response.status}:${payload.slice(0, 1200)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    pending += decoder.decode(next.value, { stream: true });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseResponseSseBlock(block);
      if (event) yield event;
    }
  }
  pending += decoder.decode();
  const finalEvent = parseResponseSseBlock(pending);
  if (finalEvent) yield finalEvent;
}

function outputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      const typed = part as { type?: string; text?: string };
      if (typed?.type === "output_text" && typeof typed.text === "string") texts.push(typed.text);
    }
  }
  return texts.join("\n");
}

function parseJson<T>(value: string): T {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as T;
}

export async function planGeneration(apiKey: string, model: string, prompt: string, signal?: AbortSignal): Promise<GenerationPlan> {
  const instructions = `Jsi interní intent/spec planner KajovoCML. Vrať pouze validní JSON bez markdownu. Plánuj minimální počet samostatných CML prvků. Každý prvek je MCP_SERVER nebo AI_AGENT. AI_AGENT použij jen když je skutečně nutné LLM reasoning/generování. Neplánuj GitHub, pull requesty, CI, GHCR, OCI, integration token ani externí programmer handoff. Externí provider webhook je normální CML endpoint pod hostname výsledného prvku a provider-specific ověření se deklaruje v endpoint.auth. Dotazník je striktně minimální: ptej se jen na nenahraditelný OWNER credential, účetní identitu, e-mail, telefon nebo business pravidlo. Nikdy se neptej na hostname/server, port, protokol, TLS/SSL, endpoint, timeout ani region: tyto údaje ověř z platformy nebo provider dokumentace. Každý missingInput musí mít ownerRequired=true, ownerReason s konkrétním důvodem a derivationSource="OWNER"; providerem vydaný secret má derivationSource="PROVIDER_INTEGRATION" a NESMÍ být missingInput. Secret input označ secret=true a přiděl stableSecretName v uppercase. Každá dependency musí uvést sourceTool: název nástroje zdrojového prvku, jehož skutečné provedení tuto dependency použije, a targetTools: přesné názvy nástrojů cílového prvku; následná implementace je musí opravdu vytvořit a sourceTool musí přes context.callComponent volat cílový prvek. JSON shape: {"understoodIntent":string,"resultSummary":string,"elements":[{"key":string,"kind":"MCP_SERVER"|"AI_AGENT","displayName":string,"businessPurpose":string,"responsibilities":string[],"requiredSecretNames":string[],"providerGeneratedSecretNames"?:string[]}],"dependencies":[{"from":string,"to":string,"purpose":string,"sourceTool":string,"targetTools":string[]} ],"missingInputs":[{"key":string,"label":string,"description":string,"kind":"TEXT"|"URL"|"EMAIL"|"PHONE"|"PASSWORD"|"API_KEY"|"SECRET"|"RULE","required":boolean,"secret":boolean,"ownerRequired":true,"ownerReason":string,"derivationSource":"OWNER","stableSecretName"?:string,"grantToElementKeys"?:string[]}]} .`;
  signal?.throwIfAborted();
  const response = await responseRequest(apiKey, { model, instructions, input: prompt, tools: [{ type: "web_search" }], store: false }, signal);
  signal?.throwIfAborted();
  const plan = parseJson<GenerationPlan>(outputText(response));
  if (!plan?.elements?.length || !Array.isArray(plan.missingInputs) || !Array.isArray(plan.dependencies)) throw new Error("generation_plan_invalid");
  return plan;
}

type ToolContext = {
  workspace: string;
  sourceRoot: string;
  chromiumBinary: string;
  secretPresent: (name: string) => Promise<boolean>;
  resolveSecret: (name: string) => Promise<string>;
  upsertSecret?: (input: { stableSecretName: string; value: string; displayName?: string; description?: string; grantToElementKeys?: string[] }) => Promise<unknown>;
  browser?: BrowserSession;
  signal?: AbortSignal;
};

function safePath(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const base = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(base)) throw new Error("workspace_path_escape");
  return target;
}

async function shell(command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  if (/\b(sudo|su|systemctl|service|mount|umount|chown|chmod\s+[0-7]*[2367][0-7]*|rm\s+-rf\s+\/)\b/.test(command)) throw new Error("command_not_allowed");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], { cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: "C.UTF-8", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    const abort = () => { child.kill("SIGTERM"); setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 1000).unref(); };
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error("generation_job_cancelled"));
      const text = `stdout:\n${Buffer.concat(out).toString("utf8")}\nstderr:\n${Buffer.concat(err).toString("utf8")}`.slice(-30000);
      if (code === 0) resolve(text);
      else reject(new Error(`command_failed_${code}:${text}`));
    });
  });
}

type CandidateArtifactValidation = {
  valid: boolean;
  manifestErrors: Array<{ path?: string; keyword?: string; message?: string }>;
  handlerSyntaxError: string | null;
  canonicalTemplatePath: "component-manifest.example.json";
};

async function validateCandidateArtifacts(
  ctx: ToolContext,
  manifestPathInput: unknown,
  handlerPathInput: unknown
): Promise<CandidateArtifactValidation> {
  const manifestPath = safePath(ctx.workspace, stringArg(manifestPathInput));
  const handlerPath = safePath(ctx.workspace, stringArg(handlerPathInput));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const schema = JSON.parse(await readFile(path.join(ctx.workspace, "component-manifest.schema.json"), "utf8")) as object;
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  const valid = validate(manifest);
  const syntax = await shell(`${JSON.stringify(process.execPath)} --check ${JSON.stringify(handlerPath)}`, ctx.workspace, ctx.signal)
    .then(() => null)
    .catch((error: unknown) => error instanceof Error ? error.message : "handler_syntax_failed");
  return {
    valid: Boolean(valid) && !syntax,
    manifestErrors: valid ? [] : (validate.errors ?? []).slice(0, 20).map((item: { instancePath?: string; keyword?: string; message?: string }) => ({ path: item.instancePath, keyword: item.keyword, message: item.message })),
    handlerSyntaxError: syntax,
    canonicalTemplatePath: "component-manifest.example.json"
  };
}

function publicHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("https_required");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error("private_network_not_allowed");
  }
  return url;
}

function redactSecrets(value: string, secrets: string[]): string {
  let output = value;
  for (const secret of secrets) if (secret) output = output.split(secret).join("[REDACTED]");
  return output;
}

function browserRequired(ctx: ToolContext): BrowserSession {
  if (!ctx.browser) throw new Error("browser_unavailable_in_this_phase");
  return ctx.browser;
}

async function callTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  ctx.signal?.throwIfAborted();
  switch (name) {
    case "read_file": return (await readFile(safePath(ctx.workspace, String(args.path)), "utf8")).slice(0, 100000);
    case "read_source_file": {
      const rel = String(args.path);
      if (!/^(docs\/SSOT_CURRENT\.md|apps\/server\/src\/|packages\/)/.test(rel)) throw new Error("source_path_not_allowed");
      return (await readFile(safePath(ctx.sourceRoot, rel), "utf8")).slice(0, 100000);
    }
    case "write_file": {
      const target = safePath(ctx.workspace, String(args.path));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, String(args.content), "utf8");
      return { ok: true, path: args.path };
    }
    case "run_command": return shell(String(args.command), ctx.workspace, ctx.signal);
    case "validate_candidate_artifacts": return validateCandidateArtifacts(ctx, args.manifestPath, args.handlerPath);
    case "fetch_url": {
      const url = publicHttpsUrl(String(args.url));
      const response = await fetch(url, { signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: "follow" });
      return { status: response.status, url: response.url, body: (await response.text()).slice(0, 80000) };
    }
    case "http_request_with_secrets": {
      const url = publicHttpsUrl(stringArg(args.url));
      const method = stringArg(args.method, "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) throw new Error("http_method_not_allowed");
      const headers: Record<string, string> = {};
      for (const item of Array.isArray(args.headers) ? args.headers as Array<Record<string, unknown>> : []) headers[stringArg(item.name)] = stringArg(item.value);
      const used: string[] = [];
      for (const item of Array.isArray(args.secretHeaders) ? args.secretHeaders as Array<Record<string, unknown>> : []) {
        const value = await ctx.resolveSecret(stringArg(item.secretName)); used.push(value); headers[stringArg(item.header)] = value;
      }
      const bodyType = stringArg(args.bodyType, "NONE").toUpperCase();
      let requestBody: string | undefined;
      if (bodyType === "JSON") {
        const body = parseObjectJson(args.jsonBody);
        for (const item of Array.isArray(args.secretBodyFields) ? args.secretBodyFields as Array<Record<string, unknown>> : []) {
          const value = await ctx.resolveSecret(stringArg(item.secretName)); used.push(value); body[stringArg(item.field)] = value;
        }
        requestBody = JSON.stringify(body); headers["content-type"] ??= "application/json";
      } else if (bodyType === "FORM") {
        const form = new URLSearchParams();
        for (const item of Array.isArray(args.formBody) ? args.formBody as Array<Record<string, unknown>> : []) form.append(stringArg(item.name), stringArg(item.value));
        for (const item of Array.isArray(args.secretFormFields) ? args.secretFormFields as Array<Record<string, unknown>> : []) {
          const value = await ctx.resolveSecret(stringArg(item.secretName)); used.push(value); form.append(stringArg(item.name), value);
        }
        requestBody = form.toString(); headers["content-type"] ??= "application/x-www-form-urlencoded";
      } else if (bodyType === "TEXT") requestBody = stringArg(args.textBody);
      else if (bodyType !== "NONE") throw new Error("http_body_type_not_allowed");
      const response = await fetch(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : requestBody, signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), redirect: "follow" });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = redactSecrets(value, used); });
      const rawBody = (await response.text()).slice(0, 80000);
      let json: unknown = undefined;
      try { json = JSON.parse(rawBody); } catch { /* non-JSON provider responses are allowed */ }
      let captures: unknown[] = [];
      if (Array.isArray(args.captureSecrets) && args.captureSecrets.length) {
        if (!ctx.upsertSecret) throw new Error("secret_upsert_unavailable_in_this_phase");
        const captured = await captureProviderJsonSecrets(json, args.captureSecrets as Array<Record<string, unknown>>, ctx.upsertSecret);
        captures = captured.captures; used.push(...captured.capturedPlaintext);
      }
      return { status: response.status, url: response.url, headers: responseHeaders, body: redactSecrets(rawBody, used), capturedSecrets: captures };
    }
    case "browser_open": return browserRequired(ctx).open(publicHttpsUrl(String(args.url)).toString());
    case "browser_state": return browserRequired(ctx).state();
    case "browser_click": return browserRequired(ctx).click(String(args.locator));
    case "browser_fill": return browserRequired(ctx).fill(String(args.locator), String(args.value));
    case "browser_fill_secret": {
      const value = await ctx.resolveSecret(String(args.secretName));
      await browserRequired(ctx).fill(String(args.locator), value);
      return { ok: true, locator: String(args.locator), secretName: String(args.secretName) };
    }
    case "browser_capture_secret": {
      if (!ctx.upsertSecret) throw new Error("secret_upsert_unavailable_in_this_phase");
      const captured = await captureProviderBrowserSecret(browserRequired(ctx), args as Record<string, unknown> & { locator: string; stableSecretName: string }, ctx.upsertSecret);
      return { ok: true, stableSecretName: captured.stableSecretName, stored: captured.stored };
    }
    case "browser_select": return browserRequired(ctx).select(String(args.locator), String(args.value));
    case "browser_press": return browserRequired(ctx).press(String(args.key));
    case "browser_switch_page": return browserRequired(ctx).switchPage(String(args.targetId));
    case "browser_wait": return browserRequired(ctx).wait({
      locator: typeof args.locator === "string" && args.locator ? args.locator : null,
      selector: null,
      text: typeof args.text === "string" && args.text ? args.text : null,
      urlIncludes: typeof args.urlIncludes === "string" && args.urlIncludes ? args.urlIncludes : null,
      readyState: typeof args.readyState === "string" && args.readyState ? args.readyState : null,
      timeoutMs: Number(args.timeoutMs ?? 15000)
    });
    case "secret_present": return { present: await ctx.secretPresent(String(args.name)) };
    case "secret_upsert": {
      if (!ctx.upsertSecret) throw new Error("secret_upsert_unavailable_in_this_phase");
      return ctx.upsertSecret({ stableSecretName: String(args.stableSecretName), value: String(args.value), displayName: typeof args.displayName === "string" ? args.displayName : undefined, description: typeof args.description === "string" ? args.description : undefined, grantToElementKeys: Array.isArray(args.grantToElementKeys) ? args.grantToElementKeys.map(String) : undefined });
    }
    case "sha256_file": {
      const { createHash } = await import("node:crypto");
      const bytes = await readFile(safePath(ctx.workspace, String(args.path)));
      return { digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
    }
    default: throw new Error(`unknown_tool:${name}`);
  }
}

const objectTool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false }, strict: true
});
const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const implementationTools: Array<Record<string, unknown>> = [
  { type: "web_search" },
  objectTool("read_file", "Read a UTF-8 file from the isolated generation workspace.", { path: string }, ["path"]),
  objectTool("read_source_file", "Read an approved KajovoCML source or SSOT reference file without modifying the installed platform.", { path: string }, ["path"]),
  objectTool("write_file", "Write a UTF-8 file in the generation workspace.", { path: string, content: string }, ["path", "content"]),
  objectTool("run_command", "Run build/test commands inside the isolated generation workspace. No privilege/system service commands.", { command: string }, ["command"]),
  objectTool("validate_candidate_artifacts", "Validate a generated manifest against the canonical schema and run Node syntax checking for its handler. You MUST call this after every write and correct all reported errors before returning.", { manifestPath: string, handlerPath: string }, ["manifestPath", "handlerPath"]),
  objectTool("fetch_url", "Fetch current public HTTPS technical/provider documentation. Research only; do not configure provider callbacks in IMPLEMENTING.", { url: string }, ["url"]),
  objectTool("secret_present", "Check whether a named runtime secret already exists in KajovoCML Secret Manager.", { name: string }, ["name"]),
  objectTool("sha256_file", "Compute canonical SHA-256 of a workspace file.", { path: string }, ["path"])
];

const integrationTools: Array<Record<string, unknown>> = [
  { type: "web_search" },
  objectTool("fetch_url", "Fetch current public HTTPS provider documentation.", { url: string }, ["url"]),
  objectTool("http_request_with_secrets", "Perform a provider API request; optionally capture provider-issued JSON fields directly into KajovoCML Secret Manager.", {
    url: string, method: string, bodyType: string,
    headers: { type: "array", items: { type: "object", properties: { name: string, value: string }, required: ["name", "value"], additionalProperties: false } },
    jsonBody: string,
    formBody: { type: "array", items: { type: "object", properties: { name: string, value: string }, required: ["name", "value"], additionalProperties: false } },
    textBody: string,
    secretHeaders: { type: "array", items: { type: "object", properties: { header: string, secretName: string }, required: ["header", "secretName"], additionalProperties: false } },
    secretBodyFields: { type: "array", items: { type: "object", properties: { field: string, secretName: string }, required: ["field", "secretName"], additionalProperties: false } },
    secretFormFields: { type: "array", items: { type: "object", properties: { name: string, secretName: string }, required: ["name", "secretName"], additionalProperties: false } },
    captureSecrets: { type: "array", items: { type: "object", properties: { jsonPath: string, stableSecretName: string, displayName: nullableString, description: nullableString, grantToElementKeys: { type: "array", items: string } }, required: ["jsonPath", "stableSecretName", "displayName", "description", "grantToElementKeys"], additionalProperties: false } }
  }, ["url", "method", "bodyType", "headers", "jsonBody", "formBody", "textBody", "secretHeaders", "secretBodyFields", "secretFormFields", "captureSecrets"]),
  objectTool("browser_open", "Navigate the persistent job browser session to a public HTTPS provider console.", { url: string }, ["url"]),
  objectTool("browser_state", "Read current provider console state and opaque locators across page/frame contexts.", {}, []),
  objectTool("browser_click", "Click an element using browser_state opaque locator.", { locator: string }, ["locator"]),
  objectTool("browser_fill", "Fill a non-secret provider form field.", { locator: string, value: string }, ["locator", "value"]),
  objectTool("browser_fill_secret", "Fill a provider field from an existing KajovoCML Secret Manager value.", { locator: string, secretName: string }, ["locator", "secretName"]),
  objectTool("browser_capture_secret", "Read a provider-issued value from a browser element and store/rotate it directly in KajovoCML Secret Manager with deterministic component grants.", { locator: string, stableSecretName: string, displayName: nullableString, description: nullableString, grantToElementKeys: { type: "array", items: string } }, ["locator", "stableSecretName", "displayName", "description", "grantToElementKeys"]),
  objectTool("browser_select", "Select a provider console value.", { locator: string, value: string }, ["locator", "value"]),
  objectTool("browser_press", "Press a key in the current provider page.", { key: string }, ["key"]),
  objectTool("browser_switch_page", "Switch to popup/tab targetId returned by browser_state.", { targetId: string }, ["targetId"]),
  objectTool("browser_wait", "Wait for provider UI/navigation state.", { locator: nullableString, text: nullableString, urlIncludes: nullableString, readyState: nullableString, timeoutMs: { type: "integer" } }, ["locator", "text", "urlIncludes", "readyState", "timeoutMs"]),
  objectTool("secret_present", "Check an ACTIVE named KajovoCML Secret Manager secret.", { name: string }, ["name"]),
  objectTool("secret_upsert", "Create or rotate a provider-issued credential in the existing KajovoCML Secret Manager and grant it to required generated elements.", { stableSecretName: string, value: string, displayName: nullableString, description: nullableString, grantToElementKeys: { type: "array", items: string } }, ["stableSecretName", "value", "displayName", "description", "grantToElementKeys"])
];

export type GenerationImplementationResult = {
  summary: string;
  elements: Array<{ key: string; handlerPath: string; manifestPath: string }>;
  integrationPlan?: { required: boolean; summary: string; steps: string[] };
  needsInput?: Array<{ key: string; label: string; description: string; kind: "TEXT" | "URL" | "EMAIL" | "PHONE" | "PASSWORD" | "API_KEY" | "SECRET" | "RULE"; required: boolean; secret: boolean; stableSecretName?: string; grantToElementKeys?: string[] }>;
};

export async function implementGeneration(apiKey: string, model: string, input: {
  prompt: string;
  plan: GenerationPlan;
  reservations: unknown;
  workspace: string;
  sourceRoot: string;
  chromiumBinary: string;
  secretPresent: (name: string) => Promise<boolean>;
  resolveSecret: (name: string) => Promise<string>;
  remediation?: string | null;
  repairEvidence?: Record<string, unknown> | null;
  signal?: AbortSignal;
}): Promise<GenerationImplementationResult> {
  const instructions = `Jsi zaměřený interní implementátor KajovoCML. Pracuješ výhradně v přiděleném workspace. docs/SSOT_CURRENT.md a component-manifest.schema.json jsou závazné. component-manifest.example.json je kanonická validní strukturální šablona aktuálního schema: každý nový manifest začni její kopií a změň pouze skutečné business/runtime hodnoty; nepřidávej pole, která v schema nejsou. IMPLEMENTING vytváří zdroj, manifest a integrační plán; NESMÍ konfigurovat externí provider ani předpokládat živý callback. Web research je dovolen. Nevytvářej mock, placeholder, TODO ani demo a nepoužívej GitHub/CI/GHCR/OCI/integration token. Handler exportuje tools a async invoke(name,input,context); side-effecty jsou pouze context.secret, context.callComponent, context.callExternal a bounded context.state. context.callExternal podporuje {targetHost,routePath,scope,method,headers,bodyType,body,payload,timeoutMs}; metody GET/POST/PUT/PATCH/DELETE/HEAD musí jít výhradně přes CML. DŮLEŽITÉ: runtime.executionMode je pouze REQUEST_RESPONSE nebo LONG_RUNNING, runtime.readinessMode je DEPENDENCY_AWARE a všechny tři runtime.persistentState survives* hodnoty jsou true. runtime.egressGrants obsahuje POUZE HTTPS položku {type:"HTTPS_FETCH",targetHost,port,pathPrefix,scope}. HTTP methods a auth patří výhradně do top-level outboundPolicies objektu s položkou {type:"HTTPS_FETCH",targetHost,port,pathPrefix,scope,methods,auth:{mode,...}}; nikdy je nedávej do runtime.egressGrants. contacts používají pouze {type:"EMAIL"|"SLACK"|"URL",value}. tools položka nepoužívá displayName ani sideEffectClass. endpoints položka vždy obsahuje key,method,path,scope,requestSchema,responseSchema a nepoužívá type. Veřejný provider webhook deklaruj pod /webhooks/... s endpoint auth.mode EXTERNAL_WEBHOOK a verification. Secret, který má provider vydat až po nasazení candidate, zůstává v element.requiredSecretNames a providerGeneratedSecretNames a nesmí být hardcoded. Pro každý element vytvoř/uprav elements/<key>/handler.mjs a manifest.kcml.json, povinně volej validate_candidate_artifacts pro každý pár handler/manifest a oprav všechny vrácené chyby před odpovědí. Server před přijetím výsledku znovu validuje každý deklarovaný pár, takže nevalidní výstup neukončí implementační tool-loop. Vrať pouze JSON {"summary":string,"elements":[{"key":string,"handlerPath":string,"manifestPath":string}],"integrationPlan":{"required":boolean,"summary":string,"steps":string[]}} nebo needsInput pro skutečně chybějící OWNER údaj s ownerRequired=true, ownerReason a derivationSource="OWNER". Provider-side konfigurace proběhne až v samostatné INTEGRATING fázi po deploy candidate runtime.`
  let previous: string | undefined;
  let inputPayload: unknown = `Owner prompt:\n${input.prompt}\n\nApproved plan:\n${JSON.stringify(input.plan)}\n\nReservations:\n${JSON.stringify(input.reservations)}${input.repairEvidence ? `\n\nMonitoring/error evidence for repair:\n${JSON.stringify(input.repairEvidence)}` : ""}${input.remediation ? `\n\nPrevious technical failure to remediate:\n${input.remediation}` : ""}`;
  const context: ToolContext = { ...input };
  {
    for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
      input.signal?.throwIfAborted();
      const requestBody: Record<string, unknown> = { model, instructions, input: inputPayload, tools: implementationTools, store: true };
      if (previous) requestBody.previous_response_id = previous;
      const response = await responseRequest(apiKey, requestBody, input.signal);
      input.signal?.throwIfAborted();
      previous = String(response.id);
      const outputs = Array.isArray(response.output) ? response.output as Array<Record<string, unknown>> : [];
      const calls = outputs.filter((item) => item?.type === "function_call");
      if (!calls.length) {
        const result = parseJson<GenerationImplementationResult>(outputText(response));
        if (result.needsInput?.length) return result;
        if (!result.elements?.length) throw new Error("generation_implementation_result_invalid");
        const validations = await Promise.all(result.elements.map(async (element) => {
          try {
            return { key: element.key, ...(await validateCandidateArtifacts(context, element.manifestPath, element.handlerPath)) };
          } catch (error) {
            return { key: element.key, valid: false, manifestErrors: [], handlerSyntaxError: error instanceof Error ? error.message : "candidate_validation_failed", canonicalTemplatePath: "component-manifest.example.json" as const };
          }
        }));
        if (validations.every((item) => item.valid)) return result;
        inputPayload = `FINAL_CANDIDATE_VALIDATION_FAILED. Výsledek nelze přijmout. Znovu načti component-manifest.example.json, zachovej jeho přesnou povolenou strukturu, oprav uvedené soubory, znovu zavolej validate_candidate_artifacts pro každý pár a vrať finální JSON až po validním výsledku. Bezpečné validační chyby:\n${JSON.stringify(validations)}`;
        continue;
      }
      const toolOutputs: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        input.signal?.throwIfAborted();
        let output: unknown;
        try { output = await callTool(stringArg(call.name), parseObjectJson(call.arguments), context); }
        catch (error) {
          if (input.signal?.aborted) throw (input.signal.reason instanceof Error ? input.signal.reason : new Error("generation_job_cancelled"));
          output = { error: error instanceof Error ? error.message : "tool_failed" };
        }
        toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      }
      inputPayload = toolOutputs;
    }
    throw new Error("generation_model_turn_limit");
  }
}

export type GenerationIntegrationResult = { summary: string; needsInput?: GenerationImplementationResult["needsInput"] };

export async function integrateGeneration(apiKey: string, model: string, input: {
  prompt: string; plan: GenerationPlan; integrationPlan?: GenerationImplementationResult["integrationPlan"];
  reservations: unknown; deployedTargets: unknown; workspace: string; sourceRoot: string; chromiumBinary: string;
  secretPresent: (name: string) => Promise<boolean>; resolveSecret: (name: string) => Promise<string>;
  upsertSecret: (input: { stableSecretName: string; value: string; displayName?: string; description?: string; grantToElementKeys?: string[] }) => Promise<unknown>;
  remediation?: string | null; signal?: AbortSignal;
}): Promise<GenerationIntegrationResult> {
  const instructions = `Jsi post-deploy integrační AI KajovoCML. Candidate komponenty jsou už registrované, lokálně nasazené a runtime health probe prošel. Konfiguruj externí provider až NYNÍ proti skutečným veřejným HTTPS MCP/webhook URL z deployedTargets. Používej browser/API nástroje, existující Secret Manager a persistentní Chromium profil. Needituj zdroj ani manifest. Chybějící existující secret nejdřív ověř secret_present. Providerem nově vydaný token/app secret ulož secret_upsert, browser_capture_secret nebo captureSecrets z API response; granty jsou deterministicky doplněny podle requiredSecretNames. Nevyžaduj OWNER copy/paste, pokud provider credential umíš získat sám. Nevytvářej nový vault/security workflow. Pokud skutečně chybí OWNER údaj, vrať JSON {"summary":string,"needsInput":[...]}; jinak proveď konfiguraci/challenge a vrať {"summary":string}.`;
  let previous: string | undefined;
  let inputPayload: unknown = `Owner prompt:
${input.prompt}

Approved plan:
${JSON.stringify(input.plan)}

Implementation integration plan:
${JSON.stringify(input.integrationPlan ?? { required:false,steps:[] })}

Deployed candidate targets (LIVE now):
${JSON.stringify(input.deployedTargets)}

Reservations:
${JSON.stringify(input.reservations)}${input.remediation ? `

Previous technical failure to remediate:
${input.remediation}` : ""}`;
  const browser = new BrowserSession({ chromiumBinary: input.chromiumBinary, workspace: input.workspace, sessionId: `generation-${path.basename(input.workspace)}` });
  const context: ToolContext = { ...input, browser };
  const abortBrowser = () => { void browser.close(); };
  input.signal?.addEventListener("abort", abortBrowser, { once: true });
  try {
    for (let turn = 0; turn < MAX_MODEL_TURNS; turn += 1) {
      input.signal?.throwIfAborted();
      const requestBody: Record<string, unknown> = { model, instructions, input: inputPayload, tools: integrationTools, store: true };
      if (previous) requestBody.previous_response_id = previous;
      const response = await responseRequest(apiKey, requestBody, input.signal);
      input.signal?.throwIfAborted();
      previous = String(response.id);
      const outputs = Array.isArray(response.output) ? response.output as Array<Record<string, unknown>> : [];
      const calls = outputs.filter((item) => item?.type === "function_call");
      if (!calls.length) return parseJson<GenerationIntegrationResult>(outputText(response));
      const toolOutputs: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        input.signal?.throwIfAborted();
        let output: unknown;
        try { output = await callTool(stringArg(call.name), parseObjectJson(call.arguments), context); }
        catch (error) {
          if (input.signal?.aborted) throw (input.signal.reason instanceof Error ? input.signal.reason : new Error("generation_job_cancelled"));
          output = { error: error instanceof Error ? error.message : "tool_failed" };
        }
        toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      }
      inputPayload = toolOutputs;
    }
    throw new Error("generation_integration_model_turn_limit");
  } finally {
    input.signal?.removeEventListener("abort", abortBrowser);
    await browser.close();
  }
}
