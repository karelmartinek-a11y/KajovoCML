#!/usr/bin/env bash
set -euo pipefail
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/legacy.env" <<'ENV'
DATABASE_URL=postgres://kcml:test@127.0.0.1/kcml
DATABASE_MIGRATOR_URL=postgres://kcml:deploy@127.0.0.1/kcml
PUBLIC_BASE_DOMAIN=hcasc.cz
ADMIN_HOST=admin.hcasc.cz
AUTH_HOST=auth.hcasc.cz
REGISTER_HOST=register.hcasc.cz
GENERATION_WORKER_INTERVAL_MS=5000
COMPONENT_WORKER_INTERVAL_MS=15000
MONITOR_INTERVAL_MS=60000
RUNTIME_SOCKET_ROOT=/var/lib/kcml/runtime
EGRESS_PROXY_SOCKET_PATH=/var/lib/kcml/egress/proxy.sock
CHROMIUM_BINARY=/opt/kcml/playwright-browsers/chromium-test/chrome
EGRESS_CAPABILITY_HMAC_KEY_BASE64=AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=
ACCESS_TOKEN_HMAC_KEY_BASE64=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB
SESSION_SECRET_BASE64=BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=
CSRF_SECRET_BASE64=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=
MFA_ENCRYPTION_KEY_BASE64=CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo=
CONFIG_VAULT_MASTER_KEY_BASE64=CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=
ENV
KCML_LEGACY_ENV="$tmp/legacy.env" KCML_CONFIG_ROOT="$tmp/config" bash deploy/scripts/split-service-config.sh test-build >/dev/null
grep -qx 'BUILD_ID=test-build' "$tmp/config/web.env"
grep -qx 'GENERATION_WORKER_ENABLED=true' "$tmp/config/worker.env"
grep -qx 'GENERATION_WORKER_INTERVAL_MS=5000' "$tmp/config/worker.env"
grep -qx 'COMPONENT_WORKER_INTERVAL_MS=15000' "$tmp/config/worker.env"
grep -qx 'CHROMIUM_BINARY=/opt/kcml/playwright-browsers/chromium-test/chrome' "$tmp/config/web.env"
grep -qx 'CHROMIUM_BINARY=/opt/kcml/playwright-browsers/chromium-test/chrome' "$tmp/config/worker.env"
if grep -R -q -E 'GITHUB_|GHCR_|ONBOARDING_WORKER' "$tmp/config"; then exit 1; fi
test "$(cat "$tmp/config/credentials/web/access_token_hmac")" = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB'
test "$(cat "$tmp/config/credentials/config_vault_master_key")" = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk='
echo 'split-service-config:PASS'
