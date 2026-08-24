#!/usr/bin/env node
import { readFile, access } from "node:fs/promises";

async function text(path) { return readFile(path, "utf8"); }
function requireText(source, needle, label) { if (!source.includes(needle)) throw new Error(`${label}: missing ${needle}`); }
function forbidText(source, needle, label) { if (source.includes(needle)) throw new Error(`${label}: forbidden ${needle}`); }

const app = await text("apps/server/src/app.ts");
requireText(app, "registerGenerationRoutes", "app generation route");
forbidText(app, "registerOnboardingRoutes", "retired onboarding route");
const componentRoutes = await text("apps/server/src/http/component-routes.ts");
forbidText(componentRoutes, "/v2/component-onboardings", "retired component onboarding intake");
const packageJson = JSON.parse(await text("package.json"));
const pretest = String(packageJson.scripts?.pretest ?? "");
for (const legacy of ["repository-component", "onboarding-catalog", "generate-mcp-onboarding"]) forbidText(pretest, legacy, "pretest");
const install = await text("deploy/scripts/install-release.sh");
for (const legacy of ["kcml-onboarding-worker", "GHCR_TOKEN", "GITHUB_TOKEN", "stage_registry_auth", "repository-component-deploy"]) forbidText(install, legacy, "production install");
requireText(install, "kcml-generation-worker", "production install");
requireText(install, "kcml-generated-component@.service", "production install");
const generation = await text("apps/server/src/generation/worker.ts");
for (const legacy of ["github", "ghcr", "OCI_REGISTRY", "pull request"]) forbidText(generation.toLowerCase(), legacy.toLowerCase(), "generation worker");
for (const required of ["recoverGenerationTechnicalFailure", "cancelGeneratedCandidateRelease", "restoreRepairBaseState"]) requireText(generation, required, "generation technical failure cleanup wiring");

const mcpRuntime = await text("apps/server/src/http/component-mcp-runtime.ts");
requireText(mcpRuntime, 'path: "/mcp"', "generated MCP internal dispatch");
requireText(mcpRuntime, "generatedRuntimeCredential", "generated MCP credential handoff");
const webhookRuntime = await text("apps/server/src/http/component-webhook-runtime.ts");
requireText(webhookRuntime, 'app.all("/webhooks/*"', "generated public webhook ingress");
requireText(webhookRuntime, "EXTERNAL_WEBHOOK", "provider webhook auth");
const generatedDomain = await text("apps/server/src/domain/generated-component.ts");
for (const required of ["materializeGenerationDependencies", "verifyGenerationDependencies", "verifyGeneratedPublicMcpBeforeActivation", "verifyGeneratedWebhookPublicIngress", "probeUdsComponentRuntime"]) requireText(generatedDomain, required, "generated CML conformance");
const generationDomain = await text("apps/server/src/domain/generation.ts");
requireText(generationDomain, "enqueueGeneratedRepairJob", "generated repair");
requireText(generationDomain, "authority_kind='INHERITED_TECHNICAL'", "repair execution authority");
requireText(generationDomain, "generation_repair_spec_lineage_missing", "repair lineage blocker");
for (const legacy of ['state = \'CREATED\'', 'state = \'NEEDS_INPUT\'', 'state = \'PLAN_READY\'', 'state=\'CREATED\'', 'state=\'NEEDS_INPUT\'', 'state=\'PLAN_READY\'']) forbidText(generationDomain, legacy, "retired generation state path");
for (const required of ["grantGenerationSecretToElements", "resumeGenerationAfterSatisfiedInputs", "upsertGenerationSecret"]) requireText(generationDomain, required, "INTEGRATING secret grant-before-resume wiring");
for (const required of ["createGenerationFollowUpJob", "ownerRequiredInputs", "generation.follow_up_created"]) requireText(generationDomain, required, "linked follow-up and minimal-questionnaire controls");
const generationRoutes = await text("apps/server/src/http/generation-routes.ts");
requireText(generationRoutes, "/api/generation/jobs/:id/runs", "linked follow-up route");
const discussion = await text("apps/server/src/domain/generation-discussion.ts");
for (const required of ["lookup_cml_capabilities", "read_cml_capability_contract", "CAPABILITY_LOOKUP_REQUIRED", "CAPABILITY_CONTRACT_INSPECTION_REQUIRED", "capabilityReferencesStillCurrent", "lease_token", "recoverExpiredDiscussionTurns"]) requireText(discussion, required, "persistent capability-first discussion contract");
requireText(discussion, "createSpecRevision(db, claimed.jobId, parsed, claimed.turnId, lease)", "lease-fenced specification write");
for (const legacy of ["assistantMessage", "specification JSON"]) forbidText(discussion, legacy, "legacy raw JSON discussion transport");
const generationPrompt = await text("apps/server/src/generation/openai-responses.ts");
for (const required of ["validate_candidate_artifacts", "runtime.egressGrants obsahuje POUZE", "outboundPolicies objektu"]) requireText(generationPrompt, required, "manifest preflight contract");
const browser = await text("apps/server/src/generation/browser-session.mjs");
requireText(browser, "playwright-session.mjs", "interactive generation browser adapter");
const playwrightSession = await text("apps/server/src/generation/playwright-session.mjs");
for (const required of ["chromium.launch", "browser.newContext", "safeUrl"]) requireText(playwrightSession, required, "Playwright browser platform");
for (const forbidden of ["--no-sandbox", "Runtime.evaluate", "Page.navigate", "Input.dispatchKeyEvent"]) forbidText(playwrightSession, forbidden, "Playwright browser platform");
requireText(playwrightSession, "chromiumSandbox: true", "Playwright browser platform must enable the Chromium sandbox");
const runtimeHost = await text("apps/server/src/generation/runtime-host.mjs");
requireText(runtimeHost, "GeneratedHandlerSandbox", "generated handler capability boundary");
const handlerSandbox = await text("apps/server/src/generation/handler-sandbox.mjs");
for (const required of ["/usr/bin/unshare", '"--mount", "--net"', '"--pid", "--fork"', "/usr/sbin/chroot", "mount -o remount,bind,ro"]) requireText(handlerSandbox, required, "generated handler OS capability boundary");
for (const file of ["apps/server/src/generation/handler-sandbox.mjs", "apps/server/src/generation/handler-sandbox-worker.mjs", "apps/server/src/generation/generation-cancellation.mjs", "apps/server/src/generation/generation-release-cleanup.mjs", "apps/server/src/generation/generation-failure-recovery.mjs", "apps/server/src/generation/generation-secret-grant-control.mjs", "apps/server/src/onboarding/generated-repair-enqueue.mjs", "scripts/test-generated-handler-capabilities.mjs", "scripts/test-generation-cancellation.mjs", "scripts/test-generation-technical-failure-cleanup.mjs", "scripts/test-generation-integrating-secret-grant.mjs", "scripts/test-repair-enqueue-control.mjs"]) await access(file);
await access("scripts/test-generation-browser.mjs");
await access("scripts/test-generation-automation-runtime-no-ai.mjs");
await access("scripts/test-generated-platform-live.mjs");
try { await access("deploy/scripts/kcml-deploy-wrapper.sh"); throw new Error("production install: retired GitHub/GHCR deploy wrapper still exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const migration = await text("apps/server/src/migrations/009_internal_generation.sql");
for (const table of ["generation_job", "generation_component", "component_runtime_identity", "local_component_release"]) {
  const qualified = `CREATE TABLE public.${table}`;
  const unqualified = `CREATE TABLE ${table}`;
  if (!migration.includes(qualified) && !migration.includes(unqualified)) {
    throw new Error(`generation migration: missing ${qualified}`);
  }
}
const followUpMigration = await text("apps/server/src/migrations/013_generation_follow_up_runs.sql");
for (const required of ["parent_job_id", "run_sequence", "'RETRY'", "generation_job_active_component_follow_up_idx"]) requireText(followUpMigration, required, "generation follow-up migration");
const authorityMigration = await text("apps/server/src/migrations/022_generation_execution_authority.sql");
for (const required of ["authority_kind", "authority_source_job_id", "authority_source_spec_revision_id", "authority_spec_digest", "lease_token", "generation_job_authority_source_spec_fk"]) requireText(authorityMigration, required, "generation execution authority migration");
const browserRuntimeMigration = await text("apps/server/src/migrations/023_browser_automation_execution_runtime.sql");
for (const required of ["browser_automation_run", "lease_token", "CANCEL_REQUESTED", "side_effect_class"]) requireText(browserRuntimeMigration, required, "browser automation execution runtime migration");
const browserHeartbeatMigration = await text("apps/server/src/migrations/024_browser_automation_worker_heartbeat.sql");
for (const required of ["BROWSER_AUTOMATION", "platform_worker_heartbeat_worker_kind_check"]) requireText(browserHeartbeatMigration, required, "browser automation worker heartbeat migration");
const singleOwnerMigration = await text("apps/server/src/migrations/025_single_owner_human_role.sql");
for (const required of ["UPDATE public.admin_account", "SET role = 'OWNER'", "DROP CONSTRAINT IF EXISTS admin_account_role_check", "CHECK (role = 'OWNER')"]) requireText(singleOwnerMigration, required, "single OWNER human-role migration");
const ui = await text("apps/admin-ui/src/app-layout.tsx");
requireText(ui, 'navigationButton("generation", "Generování"', "OWNER navigation");
for (const file of ["deploy/systemd/kcml-generation-worker.service", "deploy/systemd/kcml-browser-automation-worker.service", "deploy/systemd/kcml-generated-component@.service", "deploy/scripts/kcml-generated-runtime-helper", "apps/server/src/http/generation-routes.ts", "apps/server/src/http/browser-automation-routes.ts", "apps/server/src/domain/browser-automation.ts"]) await access(file);
process.stdout.write("internal-generation-contract:PASS\n");
