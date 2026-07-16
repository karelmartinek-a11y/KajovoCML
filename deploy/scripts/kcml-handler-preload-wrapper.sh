#!/usr/bin/env bash
set -euo pipefail
umask 077

source_commit="${1:?source commit required}"
ghcr_actor="${2:?GHCR actor required}"
fail() {
  echo "handler-preload: $*" >&2
  exit 1
}

[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "invalid source commit"
[[ "$ghcr_actor" =~ ^[A-Za-z0-9-]{1,39}$ ]] || fail "invalid GHCR actor"
test "$(id -u)" = "0" || fail "wrapper must run as root"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"

database_url_file="${KCML_WORKER_DATABASE_URL_FILE:-/etc/kcml/credentials/worker/database_url}"
test -s "$database_url_file" || fail "worker database credential is unavailable"
DATABASE_URL="$(cat "$database_url_file")"
test -n "$DATABASE_URL" || fail "worker database credential is empty"

auth_file=/var/lib/kcml/podman/auth.json
docker_config=/var/lib/kcml/podman/.docker/config.json
# shellcheck disable=SC2329
cleanup() {
  rm -f "$auth_file" "$docker_config"
}
trap cleanup EXIT

install -d -m 0700 -o kcml -g kcml /var/lib/kcml/podman /var/lib/kcml/podman/.docker
encoded_auth="$(printf '%s:%s' "$ghcr_actor" "$GHCR_TOKEN" | base64 -w0)"
printf '{"auths":{"ghcr.io":{"auth":"%s"}}}\n' "$encoded_auth" > "$auth_file"
unset encoded_auth GHCR_TOKEN
chown kcml:kcml "$auth_file"
chmod 0600 "$auth_file"
install -m 0600 -o kcml -g kcml "$auth_file" "$docker_config"

# The worker polls on its own. Restarting it here could interrupt an in-flight
# signature verification while the bounded registry credential is available.
systemctl is-active --quiet kcml-onboarding-worker || fail "onboarding worker is not active"
for _attempt in $(seq 1 120); do
  IFS='|' read -r state runtime_socket < <(psql "$DATABASE_URL" -Atq \
    -c "select job.state, coalesce(server.runtime_socket, '')
          from onboarding_job job
          left join mcp_server server on server.id=job.server_id
         where job.source_commit='$source_commit'
         order by job.created_at desc
         limit 1")
  case "$state" in
    REGISTERED_DISABLED|TRIAL_TESTING|ACTIVE)
      if [ -n "$runtime_socket" ] && [ -S "$runtime_socket" ]; then
        exit 0
      fi
      ;;
    FAILED|QUARANTINED|CANCELLED)
      echo "Onboarding reached terminal state $state while the private image credential was active." >&2
      exit 1
      ;;
  esac
  sleep 5
done
echo "The onboarding worker did not verify the private image before the credential window expired." >&2
exit 1
