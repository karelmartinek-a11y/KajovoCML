#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pattern='GITHUB_|GHCR_|ONBOARDING_WORKER'
printf '%s\n' 'GITHUB_TOKEN=fixture-for-negative-check' > "$tmp/forbidden.env"
printf '%s\n' 'SAFE_RUNTIME_MODE=worker' > "$tmp/clean.env"

if ! grep -R -q -E "$pattern" "$tmp/forbidden.env"; then
  echo "negative pattern fixture did not detect the forbidden input" >&2
  exit 1
fi

if grep -R -q -E "$pattern" "$tmp/clean.env"; then
  echo "negative pattern fixture reported a clean input as forbidden" >&2
  exit 1
fi

echo 'portable-negative-pattern-guards:PASS'
