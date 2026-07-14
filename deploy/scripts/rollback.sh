#!/usr/bin/env bash
set -euo pipefail

release="${1:?release id required}"
target="/opt/kcml/releases/$release"
test -d "$target"
bash "$(dirname "$0")/release-config.sh" restore "$release" "$target"
for unit in kcml kcml-onboarding-worker kcml-monitor kcml-egress-proxy kcml-alert-primary kcml-alert-backup; do
  if systemctl cat "$unit.service" >/dev/null 2>&1; then systemctl is-active --quiet "$unit.service"; fi
done
curl -fsS https://admin.hcasc.cz/health >/dev/null
echo "rollback-ok:$release"
