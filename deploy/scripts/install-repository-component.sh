#!/usr/bin/env bash
set -euo pipefail
umask 027

repository_key="${1:?repository key required}"
source_commit="${2:?source commit required}"
image_reference="${3:?image reference required}"
image_digest="${4:?image digest required}"
build_run_id="${5:?build run id required}"
deploy_run_id="${6:?deploy run id required}"
deploy_run_attempt="${7:?deploy run attempt required}"
requested_git_ref="${8:-}"
receipt_path="${9:?receipt path required}"

[[ "$repository_key" =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]] || { echo "invalid repository key" >&2; exit 2; }
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]] || { echo "invalid source commit" >&2; exit 2; }
[[ "$image_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "invalid image digest" >&2; exit 2; }
case "$build_run_id:$deploy_run_id:$deploy_run_attempt" in *[!0-9:]*) echo "invalid run identifiers" >&2; exit 2 ;; esac
test "$(id -u)" = "0"
test -f /etc/kcml/kcml.env

set -a
# shellcheck source=/dev/null
. /etc/kcml/kcml.env
set +a

podman_binary="${PODMAN_BINARY:-podman}"
runtime_root="/var/lib/kcml/repository-components/${repository_key}"
candidate_root="${runtime_root}/candidate"
live_root="${runtime_root}/live"
container_name="kcml-repository-component-${repository_key}"
candidate_name="${container_name}-candidate"
requested_git_ref_json="null"
if [ -n "$requested_git_ref" ]; then
  requested_git_ref_json="$(jq -Rn --arg value "$requested_git_ref" '$value')"
fi

install -d -m 0750 -o kcml -g kcml "$runtime_root" "$candidate_root" "$live_root"
rm -f "${candidate_root}/worker.sock"

previous_digest="$(
  runuser -u kcml -- "$podman_binary" container inspect "$container_name" --format '{{index .Config.Labels "cz.hcasc.kcml.image-digest"}}' 2>/dev/null || true
)"
previous_image_reference="$(
  runuser -u kcml -- "$podman_binary" container inspect "$container_name" --format '{{.ImageName}}' 2>/dev/null || true
)"

immutable_image="${image_reference%@*}@${image_digest}"
runuser -u kcml -- "$podman_binary" pull "$immutable_image" >/dev/null
runuser -u kcml -- "$podman_binary" rm --force --ignore "$candidate_name" >/dev/null 2>&1 || true
runuser -u kcml -- "$podman_binary" run --detach --replace \
  --name "$candidate_name" \
  --label "cz.hcasc.kcml.repository-component=true" \
  --label "cz.hcasc.kcml.repository-key=${repository_key}" \
  --label "cz.hcasc.kcml.image-digest=${image_digest}" \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --network none \
  --log-driver none \
  --pids-limit 256 \
  --memory 256m \
  --cpus 1.0 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --volume "${candidate_root}:/run/kcml:rw,z" \
  --env KCML_SOCKET_PATH=/run/kcml/worker.sock \
  --env KCML_SERVER_CODE="repository-${repository_key}" \
  --env KCML_IMAGE_DIGEST="${image_digest}" \
  "$immutable_image" >/dev/null

health_ok=false
for _attempt in $(seq 1 60); do
  if [ -S "${candidate_root}/worker.sock" ] && curl --fail --silent --show-error --unix-socket "${candidate_root}/worker.sock" http://localhost/health >/tmp/repository-component-health.json 2>/dev/null; then
    health_ok=true
    break
  fi
  sleep 1
done
if [ "$health_ok" != "true" ]; then
  runuser -u kcml -- "$podman_binary" logs "$candidate_name" >/dev/null 2>&1 || true
  runuser -u kcml -- "$podman_binary" rm --force --ignore "$candidate_name" >/dev/null 2>&1 || true
  echo "candidate runtime failed health check" >&2
  exit 1
fi

runuser -u kcml -- "$podman_binary" rm --force --ignore "$container_name" >/dev/null 2>&1 || true
runuser -u kcml -- "$podman_binary" rename "$candidate_name" "$container_name"
rm -f "${live_root}/worker.sock"
mv "${candidate_root}/worker.sock" "${live_root}/worker.sock"

actual_image_reference="$(runuser -u kcml -- "$podman_binary" container inspect "$container_name" --format '{{.ImageName}}')"
actual_digest="$(runuser -u kcml -- "$podman_binary" container inspect "$container_name" --format '{{index .Config.Labels "cz.hcasc.kcml.image-digest"}}')"
checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
health_body="$(cat /tmp/repository-component-health.json)"
evidence_digest="$(printf '%s' "$health_body" | sha256sum | awk '{print "sha256:" $1}')"

jq -n \
  --arg repositoryKey "$repository_key" \
  --arg sourceCommit "$source_commit" \
  --arg imageReference "$actual_image_reference" \
  --arg imageDigest "$actual_digest" \
  --arg buildRunId "$build_run_id" \
  --arg deployRunId "$deploy_run_id" \
  --arg deployRunAttempt "$deploy_run_attempt" \
  --arg workflow ".github/workflows/repository-component-deploy.yml" \
  --arg runtimeKind "UDS" \
  --arg runtimeLocation "${live_root}/worker.sock" \
  --arg runtimeIdentifier "$container_name" \
  --arg previousImageDigest "${previous_digest:-}" \
  --arg requestedGitRef "${requested_git_ref}" \
  --arg deployedAt "$checked_at" \
  --arg checkedAt "$checked_at" \
  --arg evidenceDigest "$evidence_digest" \
  '
  {
    schemaVersion: "1.0",
    repositoryKey: $repositoryKey,
    requestedGitRef: ($requestedGitRef | if . == "" then null else . end),
    sourceCommit: $sourceCommit,
    imageReference: $imageReference,
    imageDigest: $imageDigest,
    componentVersion: $sourceCommit,
    buildRunId: $buildRunId,
    deployRunId: $deployRunId,
    deployRunAttempt: $deployRunAttempt,
    workflow: $workflow,
    runtimeKind: $runtimeKind,
    runtimeLocation: $runtimeLocation,
    runtimeIdentifier: $runtimeIdentifier,
    previousImageDigest: ($previousImageDigest | if . == "" then null else . end),
    deployedAt: $deployedAt,
    health: {
      status: "PASS",
      checkedAt: $checkedAt,
      evidenceDigest: $evidenceDigest
    }
  }' > "$receipt_path"
