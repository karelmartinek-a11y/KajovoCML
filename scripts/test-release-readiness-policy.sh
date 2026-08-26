#!/usr/bin/env bash
set -euo pipefail

confirm_samples() {
  local consecutive=0 sample
  for sample in "$@"; do
    if [ "$sample" = PASS ]; then consecutive=$((consecutive + 1)); else consecutive=0; fi
  done
  [ "$consecutive" -ge 4 ]
}

if confirm_samples FAIL FAIL FAIL PASS; then
  echo "readiness policy incorrectly accepted non-consecutive samples" >&2
  exit 1
fi
confirm_samples PASS PASS PASS PASS
echo "release-readiness-policy:PASS"
