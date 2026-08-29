#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(uname -s)" != Linux ]; then
  echo "production-shaped-generated-runtime-container:UNSUPPORTED non-Linux host" >&2
  exit 2
fi
command -v docker >/dev/null
test -n "${GITHUB_SHA:-}"
test -n "${KCML_TEST_NODE_BIN:-}"
test -x "$KCML_TEST_NODE_BIN"
selected_node_version="$($KCML_TEST_NODE_BIN --version)"
selected_node_major="${selected_node_version#v}"
selected_node_major="${selected_node_major%%.*}"
test "$selected_node_major" = 24

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
node_dir="$(dirname "$KCML_TEST_NODE_BIN")"
container_id=""
ubuntu_image_digest_part_a=33ceb71981b602c1a7443a53469e4dba065f7503eab3078
ubuntu_image_digest_part_b=2d7a57a2ab987517
image="${KCML_SYSTEMD_HARNESS_IMAGE:-ubuntu@sha256:${ubuntu_image_digest_part_a}${ubuntu_image_digest_part_b}}"
container_node_bin=/opt/kcml-ci/node24/bin/node

cleanup() {
  set +e
  if [ -n "$container_id" ]; then
    docker logs "$container_id" 2>&1 | tail -n 120 || true
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "production-shaped-generated-runtime-container:image=$image:selected_node_path=$KCML_TEST_NODE_BIN:selected_node_version=$selected_node_version:sha=$GITHUB_SHA"
container_id="$(docker run --detach --privileged --cgroupns=private \
  --tmpfs /run --tmpfs /run/lock \
  --volume /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --volume "$repo_root:/workspace:ro" \
  --volume "$node_dir:/opt/kcml-ci/node24/bin:ro" \
  "$image" /sbin/init)"

docker exec --env GITHUB_SHA="$GITHUB_SHA" --env KCML_TEST_NODE_VERSION="$selected_node_version" "$container_id" bash -Eeuo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes --no-install-recommends ca-certificates curl git jq procps systemd systemd-sysv util-linux passwd sudo
  cd /workspace
  git config --global --add safe.directory /workspace
  actual_sha="$(git rev-parse HEAD)"
  test "$actual_sha" = "$GITHUB_SHA"
  test "$(ps -p 1 -o comm= | tr -d " ")" = systemd
  systemctl is-system-running
  command -v systemd-run >/dev/null
  command -v systemd-creds >/dev/null
  groupadd --system kcml 2>/dev/null || true
  id kcml-runtime >/dev/null 2>&1 || useradd --system --gid kcml --home-dir /nonexistent --shell /usr/sbin/nologin kcml-runtime
  runuser -u kcml-runtime -- /usr/bin/setpriv --no-new-privs /usr/bin/unshare --user --map-root-user --mount --net --ipc --uts --pid --fork --kill-child=SIGKILL /bin/true
  echo "production-shaped-generated-runtime-container:capability_probe=PASS:pid1=systemd:systemd_manager=PASS:user_namespace=PASS:sha=$actual_sha"
  test "$(/opt/kcml-ci/node24/bin/node --version)" = "$KCML_TEST_NODE_VERSION"
  KCML_TEST_NODE_BIN=/opt/kcml-ci/node24/bin/node KCML_TEST_NODE_VERSION="$KCML_TEST_NODE_VERSION" bash scripts/test-production-shaped-generated-runtime.sh
'
