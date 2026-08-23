import { readFile } from "node:fs/promises";

const files = {
  acceptance: "apps/server/src/cli/ssot-production-acceptance.ts",
  workflow: ".github/workflows/ci-deploy.yml",
  installer: "deploy/scripts/install-release.sh",
  releaseGuard: "scripts/test-build-release.sh"
};

const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")])
));

const requireText = (key, text) => {
  if (!source[key].includes(text)) throw new Error(`ssot acceptance guard missing ${key}: ${text}`);
};

requireText("acceptance", "requireDeploymentManagedAdminPassword(process.env.PASS)");
requireText("acceptance", "KCML_ACCEPTANCE_BASE_URL_must_be_https");
requireText("acceptance", "safeIdentifiersOnly: true");
requireText("acceptance", "chromium.launch");
requireText("acceptance", "browser.newContext");
requireText("acceptance", "lookup_cml_capabilities");
requireText("acceptance", "read_cml_capability_contract");
requireText("acceptance", "safe production acceptance cleanup");
requireText("acceptance", "Last-Event-ID reconnect has no duplicate cursor");
requireText("workflow", "run_full_ssot_acceptance:");
requireText("workflow", "KCML_RUN_FULL_SSOT_ACCEPTANCE");
requireText("workflow", "--preserve-env=PASS,KCML_FACTORY_RESET_CONFIRM,KCML_RUN_FULL_SSOT_ACCEPTANCE");
requireText("installer", 'if [ "${KCML_RUN_FULL_SSOT_ACCEPTANCE:-false}" = "true" ]; then');
requireText("installer", "dist/cli/ssot-production-acceptance.js");
requireText("installer", 'KCML_ACCEPTANCE_BASE_URL="https://${admin_host}"');
requireText("installer", 'echo "ssot-acceptance:$acceptance_line"');
requireText("workflow", "ssot-acceptance:");
requireText("releaseGuard", "dist/cli/ssot-production-acceptance.js");

for (const forbidden of [
  "process.env.OPENAI_API_KEY",
  "process.env.GITHUB_TOKEN",
  "Authorization: Bearer",
  "console.log(password)",
  "console.log(process.env.PASS)",
  "console.log(config.ADMIN_TOTP_SECRET)"
]) {
  if (source.acceptance.includes(forbidden)) throw new Error(`ssot acceptance guard found forbidden credential handling: ${forbidden}`);
}

console.log("ssot-production-acceptance-guard:PASS");
