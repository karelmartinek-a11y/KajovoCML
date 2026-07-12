#!/usr/bin/env bash
set -euo pipefail

nginx -t
ss -ltnp | grep -E ':(80|443)\s' >/dev/null
test -n "${DATABASE_URL:-}"
test -n "${ACCESS_TOKEN_HMAC_KEY_BASE64:-}"
test -n "${SESSION_SECRET_BASE64:-}"
test -n "${CSRF_SECRET_BASE64:-}"
test -n "${MFA_ENCRYPTION_KEY_BASE64:-}"
echo "preflight-ok"
