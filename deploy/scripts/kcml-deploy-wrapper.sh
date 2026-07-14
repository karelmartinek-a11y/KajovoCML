#!/usr/bin/env bash
set -euo pipefail
umask 077

artifact="${1:?release artifact required}"
repository="${2:?repository required}"
source_commit="${3:?source commit required}"
run_id="${4:?run id required}"
run_attempt="${5:?run attempt required}"
case "$repository" in *[!A-Za-z0-9._/-]*) exit 2 ;; esac
case "$source_commit" in *[!a-f0-9]*|'') exit 2 ;; esac
case "$run_id:$run_attempt" in *[!0-9:]*) exit 2 ;; esac
test "$(id -u)" = "0"
test -n "${GH_TOKEN:-}"
test -n "${PASS:-}"

artifact="$(realpath -e "$artifact")"
test -f "$artifact"
test ! -L "$artifact"
test "$(stat -c '%U' "$artifact")" = "kcml-deploy"
gh attestation verify "$artifact" \
  --repo "$repository" \
  --signer-workflow "$repository/.github/workflows/ci-deploy.yml" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
  --source-ref "refs/heads/main" \
  --source-digest "$source_commit" \
  --deny-self-hosted-runners >/dev/null

release_id="${source_commit}-${run_id}-${run_attempt}"
staging="/opt/kcml/releases/.staging-$release_id"
rm -rf "$staging"
install -d -m 0750 -o root -g kcml "$staging"
tar --zstd --extract --file "$artifact" --directory "$staging" --no-same-owner --no-same-permissions
test "$(jq -r .sourceCommit "$staging/release-manifest.json")" = "$source_commit"
test "$(jq -r .repository "$staging/release-manifest.json")" = "$repository"
test "$(jq -r .workflow "$staging/release-manifest.json")" = "$repository/.github/workflows/ci-deploy.yml@refs/heads/main"
unset GH_TOKEN
exec "$staging/deploy/scripts/install-release.sh" "$staging" "$release_id"
