#!/usr/bin/env bash
set -euo pipefail

workflow=.github/workflows/ci-deploy.yml

# A GitHub cancellation must terminate only the deployment child session. The
# runner's own process group contains the self-hosted listener and must never
# be signalled as a cleanup shortcut.
grep -Fq 'timeout-minutes: 30' "$workflow"
grep -Fq 'command -v setsid >/dev/null' "$workflow"
grep -Fq 'setsid sudo -n --preserve-env=PASS,KCML_FACTORY_RESET_CONFIRM' "$workflow"
grep -Fq 'stop_deploy_child() {' "$workflow"
grep -Fq 'kill -TERM -- "-$deploy_pid"' "$workflow"
grep -Fq "trap 'stop_deploy_child; exit 143' INT TERM" "$workflow"

echo 'deploy-cancellation-guard:PASS'
