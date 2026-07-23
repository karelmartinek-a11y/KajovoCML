#!/usr/bin/env bash
set -euo pipefail

pr_workflow=".github/workflows/repository-component-pr.yml"
deploy_workflow=".github/workflows/repository-component-deploy.yml"
test -f "$pr_workflow"
test -f "$deploy_workflow"

grep -Fq 'paths:' "$pr_workflow"
grep -Fq -- '- "components/*/**"' "$pr_workflow"
grep -Fq 'Check active repository component catalog' "$pr_workflow"
grep -Fq 'node scripts/validate-repository-components.mjs --repository-key' "$pr_workflow"
grep -Fq 'pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts' "$pr_workflow"
grep -Fq 'node scripts/onboarding/contract-test.mjs' "$pr_workflow"
grep -Fq 'pnpm --ignore-workspace audit --prod --audit-level high' "$pr_workflow"
grep -Fq 'diff -u /tmp/component-build-1 /tmp/component-build-2' "$pr_workflow"

grep -Fq 'workflow_run:' "$deploy_workflow"
grep -Fq 'workflow_dispatch:' "$deploy_workflow"
grep -Fq 'repository_key:' "$deploy_workflow"
grep -Fq 'pure_change="$(jq -r '\''.pureComponentChange // true'\'' /tmp/component-change.json)"' "$deploy_workflow"
grep -Fq 'mixed_change="$(jq -r '\''.mixedChange // false'\'' /tmp/component-change.json)"' "$deploy_workflow"
grep -Fq 'if [ "$EVENT_NAME" = "push" ] && [ "$pure_change" != "true" ]; then' "$deploy_workflow"
grep -Fq 'if [ "$EVENT_NAME" = "workflow_run" ] && [ "$mixed_change" != "true" ]; then' "$deploy_workflow"
grep -Fq 'node scripts/onboarding/contract-test.mjs "components/${{ needs.discover.outputs.repository_key }}"' "$deploy_workflow"
grep -Fq 'pnpm --ignore-workspace audit --prod --audit-level high' "$deploy_workflow"
grep -Fq 'diff -u /tmp/repository-component-build-1 /tmp/repository-component-build-2' "$deploy_workflow"
grep -Fq 'https://kajovocml.hcasc.cz/contracts/repository-component-deploy/v1' "$deploy_workflow"
grep -Fq '/usr/local/sbin/kcml-repository-component-deploy-wrapper' "$deploy_workflow"
