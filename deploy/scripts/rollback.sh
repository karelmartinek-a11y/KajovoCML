#!/usr/bin/env bash
set -euo pipefail

release="${1:?release id required}"
target="/opt/kcml/releases/$release"
test -d "$target"
ln -sfn "$target" /opt/kcml/current
systemctl restart kcml
curl -fsS https://admin.hcasc.cz/health >/dev/null
echo "rollback-ok:$release"
