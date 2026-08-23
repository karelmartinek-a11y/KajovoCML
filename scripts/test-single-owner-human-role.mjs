import assert from "node:assert/strict";
import fs from "node:fs";

const activeFiles = [
  "apps/server/src/http/admin-routes.ts",
  "apps/server/src/http/dashboard-routes.ts",
  "apps/server/src/http/generation-routes.ts",
  "apps/admin-ui/src/types.ts",
  "apps/admin-ui/src/main.tsx",
  "apps/admin-ui/src/app-layout.tsx",
  "apps/admin-ui/src/admin-pages.tsx",
  "apps/admin-ui/src/component-page.tsx",
  "apps/admin-ui/src/external-components-page.tsx",
  "apps/admin-ui/src/secrets-page.tsx",
  "apps/admin-ui/src/ui-helpers.ts"
];

const forbiddenActiveHumanRolePatterns = [
  { name: "legacy human role union", pattern: /AdminRole\s*=.*(?:ADMIN|AUDITOR)/u },
  { name: "mutable role enum", pattern: /role\s*:\s*z\.enum\([^)]*(?:ADMIN|AUDITOR)/u },
  { name: "legacy human role literal", pattern: /(?:role\s*===|role\s*!==|role\s*=|role\s*:\s*|value=)\s*["'](?:ADMIN|AUDITOR)["']/u },
  { name: "legacy human role selector", pattern: /<option[^>]+value=["'](?:ADMIN|AUDITOR)["']/u },
  { name: "legacy role authorization branch", pattern: /(?:session\.role|role)\s*(?:===|!==)\s*["'](?:ADMIN|AUDITOR|OWNER)["']/u }
];

export function findForbiddenActiveHumanRolePatterns(source) {
  return forbiddenActiveHumanRolePatterns.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);
}

// Regression proof for the guard itself: a forbidden fixture must be detected,
// while the compatibility OWNER response is valid.
assert.deepEqual(findForbiddenActiveHumanRolePatterns('const role = "ADMIN";'), ["legacy human role literal"]);
assert.deepEqual(findForbiddenActiveHumanRolePatterns('return { role: "OWNER" };'), []);
assert.deepEqual(findForbiddenActiveHumanRolePatterns('if (role === "AUDITOR") return;'), ["legacy human role literal", "legacy role authorization branch"]);

const failures = [];
for (const file of activeFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const failure of findForbiddenActiveHumanRolePatterns(source)) failures.push(`${file}: ${failure}`);
}

const migration = fs.readFileSync("apps/server/src/migrations/025_single_owner_human_role.sql", "utf8");
assert.match(migration, /SET role = 'OWNER'/u);
assert.match(migration, /DROP CONSTRAINT IF EXISTS admin_account_role_check/u);
assert.match(migration, /CHECK \(role = 'OWNER'\)/u);

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}
process.stdout.write("PASS single-owner human role source guard and negative fixture guard\n");
