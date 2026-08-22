#!/usr/bin/env bash
set -euo pipefail

workflow=.github/workflows/ci-deploy.yml

# A GitHub cancellation must terminate only the deployment child session. The
# runner's own process group contains the self-hosted listener and must never
# be signalled as a cleanup shortcut.
grep -Fq 'timeout-minutes: 60' "$workflow"
grep -Fq 'command -v setsid >/dev/null' "$workflow"
grep -Fq 'setsid sudo -n --preserve-env=PASS,KCML_FACTORY_RESET_CONFIRM' "$workflow"
grep -Fq 'stop_deploy_child() {' "$workflow"
grep -Fq 'kill -TERM -- "-$deploy_pid"' "$workflow"
grep -Fq "trap 'stop_deploy_child; exit 143' INT TERM" "$workflow"

# Nested TLS work must stay in the release session. A nested setsid used to
# leave certbot alive after the GitHub deploy job timed out.
! grep -Fq 'setsid env \\' deploy/scripts/ensure-canonical-tls.sh
grep -Fq '# Keep the certbot process in the release session' deploy/scripts/ensure-canonical-tls.sh

echo 'deploy-cancellation-guard:PASS'
