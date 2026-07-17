#!/usr/bin/env bash
set -euo pipefail

install_script="deploy/scripts/install-release.sh"
monitor_unit="deploy/systemd/kcml-monitor.service"
preflight_script="deploy/scripts/preflight.sh"

test -f "$install_script"
test -f "$monitor_unit"
test -f "$preflight_script"

runtime_refresh_line="$(grep -n 'run_kcml0002_runtime_refresh' "$install_script" | tail -n 1 | cut -d: -f1)"
kcml0002_probe_line="$(grep -n '/.well-known/oauth-protected-resource/mcp' "$install_script" | tail -n 1 | cut -d: -f1)"

test -n "$runtime_refresh_line"
test -n "$kcml0002_probe_line"
test "$runtime_refresh_line" -lt "$kcml0002_probe_line"

grep -Fq 'ReadWritePaths=/var/lib/kcml/runtime /var/lib/kcml/podman /var/lib/kcml/audit' "$monitor_unit"
grep -Fq 'audit_archive_dir="$(dirname "${AUDIT_ARCHIVE_PATH:-/var/lib/kcml/audit/archive.jsonl}")"' "$preflight_script"
grep -Fq 'runuser -u kcml -- test -w "$audit_archive_dir"' "$preflight_script"
