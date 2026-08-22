#!/usr/bin/env bash
set -Eeuo pipefail

: "${KCML_RELEASE_SOURCE:?KCML_RELEASE_SOURCE is required}"
: "${KCML_ACME_ZONE:?KCML_ACME_ZONE is required}"
: "${CERTBOT_DOMAIN:?CERTBOT_DOMAIN is required}"
: "${CERTBOT_VALIDATION:?CERTBOT_VALIDATION is required}"

exec node "$KCML_RELEASE_SOURCE/apps/server/dist/cli/wedos-wapi.js" acme-auth
