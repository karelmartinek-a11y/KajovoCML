import { readFileSync } from "node:fs";

const sourcePath = "apps/server/src/tls/wedos-wapi.ts";
const workflowPath = ".github/workflows/ci-deploy.yml";
const source = readFileSync(sourcePath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");
const sha1Uses = [...source.matchAll(/createHash\("sha1"\)/g)];

if (sha1Uses.length !== 1) throw new Error("wedos_codeql_guard_requires_exactly_one_protocol_sha1");
if (!source.includes("WEDOS WAPI authenticates requests with this protocol-defined SHA-1 value.")) throw new Error("wedos_codeql_guard_missing_protocol_justification");
for (const rule of ["js/insufficient-password-hash", "js/weak-cryptographic-algorithm"]) {
  if (!workflow.includes(`.ruleId == \"${rule}\"`)) throw new Error(`wedos_codeql_guard_missing_rule:${rule}`);
}
if (!workflow.includes("wedos_sha1_line") || !workflow.includes("allowed_wedos_protocol_sha1")) throw new Error("wedos_codeql_guard_not_line_scoped");
console.log("wedos-codeql-exception:PASS");
