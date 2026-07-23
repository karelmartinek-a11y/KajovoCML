#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root_dir/deploy/scripts/install-repository-component.sh"

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT
bin_dir="$tmp_root/bin"
state_dir="$tmp_root/state"
mkdir -p "$bin_dir" "$state_dir"

cat >"$bin_dir/runuser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  if [ "$1" = "--" ]; then
    shift
    exec "$@"
  fi
  shift
done
exit 1
EOF
chmod +x "$bin_dir/runuser"

cat >"$bin_dir/podman" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${STATE_DIR:?}"
scenario="${KCML_TEST_SCENARIO:-success}"

state_file() {
  printf '%s/%s.json\n' "$state_dir" "$1"
}

socket_ok() {
  local name="$1"
  local image="$2"
  case "$scenario" in
    candidate_fail)
      [[ "$name" != *-candidate ]]
      ;;
    live_fail)
      if [[ "$name" == *-candidate ]]; then
        return 0
      fi
      [[ "$image" == *old* ]]
      ;;
    *)
      return 0
      ;;
  esac
}

ready_ok() {
  local name="$1"
  local image="$2"
  socket_ok "$name" "$image"
}

cmd="${1:?}"
shift
case "$cmd" in
  pull)
    exit 0
    ;;
  logs)
    exit 0
    ;;
  restart)
    name="${1:?}"
    file="$(state_file "$name")"
    mount_source="$(jq -r '.mountSource' "$file")"
    mkdir -p "$mount_source"
    : > "${mount_source}/worker.sock"
    printf '{"status":"ok","container":"%s"}\n' "$name" > "${mount_source}/health.json"
    printf '{"status":"READY","ready":true,"leaseHeld":true}\n' > "${mount_source}/ready.json"
    exit 0
    ;;
  rm)
    name="${@: -1}"
    file="$(state_file "$name")"
    if [ -f "$file" ]; then
      mount_source="$(jq -r '.mountSource' "$file")"
      rm -f "${mount_source}/worker.sock" "${mount_source}/health.json" "${mount_source}/ready.json"
      rm -f "$file"
    fi
    exit 0
    ;;
  container)
    sub="${1:?}"
    shift
    case "$sub" in
      inspect)
        name="${1:?}"
        shift
        format=""
        while (($#)); do
          if [ "$1" = "--format" ]; then
            format="$2"
            shift 2
          else
            shift
          fi
        done
        file="$(state_file "$name")"
        [ -f "$file" ] || exit 1
        if [[ "$format" == *".ImageName"* ]]; then
          jq -r '.imageName' "$file"
        else
          jq -r '.imageDigest' "$file"
        fi
        ;;
      *)
        exit 1
        ;;
    esac
    ;;
  run)
    name=""
    mount_source=""
    data_source=""
    image_digest=""
    image=""
    while (($#)); do
      case "$1" in
        --name)
          name="$2"
          shift 2
          ;;
        --volume)
          if [ -z "$mount_source" ]; then
            mount_source="${2%%:*}"
          else
            data_source="${2%%:*}"
          fi
          shift 2
          ;;
        --label)
          case "$2" in
            cz.hcasc.kcml.image-digest=*) image_digest="${2#*=}" ;;
          esac
          shift 2
          ;;
        --*)
          if (($# >= 2)) && [[ "$2" != --* ]]; then
            shift 2
          else
            shift
          fi
          ;;
        *)
          image="$1"
          shift
          ;;
      esac
    done
    mkdir -p "$mount_source"
    jq -n --arg imageName "$image" --arg imageDigest "$image_digest" --arg mountSource "$mount_source" --arg dataSource "$data_source" \
      '{imageName:$imageName,imageDigest:$imageDigest,mountSource:$mountSource,dataSource:$dataSource}' > "$(state_file "$name")"
    if socket_ok "$name" "$image"; then
      : > "${mount_source}/worker.sock"
      printf '{"status":"ok","container":"%s"}\n' "$name" > "${mount_source}/health.json"
      if ready_ok "$name" "$image"; then
        printf '{"status":"READY","ready":true,"leaseHeld":true}\n' > "${mount_source}/ready.json"
      fi
    else
      rm -f "${mount_source}/worker.sock" "${mount_source}/health.json" "${mount_source}/ready.json"
    fi
    printf 'fake-container-id\n'
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod +x "$bin_dir/podman"

cat >"$bin_dir/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
socket=""
while (($#)); do
  case "$1" in
    --unix-socket)
      socket="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
health_file="$(dirname "$socket")/health.json"
ready_file="$(dirname "$socket")/ready.json"
if printf '%s\n' "$*" | grep -q '/ready'; then
  [ -f "$ready_file" ] || exit 22
  cat "$ready_file"
else
  [ -f "$health_file" ] || exit 22
  cat "$health_file"
fi
EOF
chmod +x "$bin_dir/curl"

setup_case() {
  case_dir="$tmp_root/$1"
  runtime_root="$case_dir/runtime/alpha-service"
  receipt_path="$case_dir/receipt.json"
  env_file="$case_dir/etc/kcml/kcml.env"
  mkdir -p "$(dirname "$env_file")" "$runtime_root"
  printf 'PODMAN_BINARY=%s\n' "$bin_dir/podman" > "$env_file"
  printf 'STATE_DIR=%s\n' "$state_dir" >> "$env_file"
}

seed_previous_runtime() {
  local runtime_root="$1"
  local digest="$2"
  local image="ghcr.io/example/kajovocml-components/alpha-service-old@${digest}"
  local release_dir="${runtime_root}/releases/previous"
  mkdir -p "$release_dir"
  : > "${release_dir}/worker.sock"
  printf '{"status":"ok","container":"kcml-repository-component-alpha-service"}\n' > "${release_dir}/health.json"
  printf '{"status":"READY","ready":true,"leaseHeld":true}\n' > "${release_dir}/ready.json"
  ln -sfn "$release_dir" "${runtime_root}/live"
  jq -n --arg imageName "$image" --arg imageDigest "$digest" --arg mountSource "${runtime_root}/live" \
    '{imageName:$imageName,imageDigest:$imageDigest,mountSource:$mountSource}' > "${state_dir}/kcml-repository-component-alpha-service.json"
}

run_install() {
  local case_dir="$1"
  local scenario="$2"
  local runtime_root="$case_dir/runtime/alpha-service"
  local receipt_path="$case_dir/receipt.json"
  local env_file="$case_dir/etc/kcml/kcml.env"
  STATE_DIR="$state_dir" \
  KCML_ENV_FILE="$env_file" \
  KCML_REQUIRE_ROOT=0 \
  KCML_ACCEPT_TEST_SOCKET_FILE=1 \
  KCML_REPOSITORY_COMPONENT_HEALTHCHECK_ATTEMPTS=3 \
  KCML_REPOSITORY_COMPONENT_HEALTHCHECK_SLEEP_SECONDS=0 \
  KCML_RUNTIME_OWNER="$(id -un)" \
  KCML_RUNTIME_GROUP="$(id -gn)" \
  KCML_REPOSITORY_COMPONENT_RUNTIME_ROOT="$runtime_root" \
  RUNUSER_BINARY="$bin_dir/runuser" \
  CURL_BINARY="$bin_dir/curl" \
  JQ_BINARY="$(command -v jq)" \
  KCML_TEST_SCENARIO="$scenario" \
  bash "$script" alpha-service "$(printf 'a%.0s' {1..40})" "ghcr.io/example/kajovocml-components/alpha-service:$(printf 'a%.0s' {1..40})" "sha256:$(printf 'b%.0s' {1..64})" 100 200 1 refs/heads/main LONG_RUNNING true 45 "$receipt_path"
}

setup_case first
run_install "$tmp_root/first" success
jq -e '.health.status == "PASS" and .readiness.status == "READY" and .runtimeLocation == "'"$tmp_root"'/first/runtime/alpha-service/live/worker.sock"' "$tmp_root/first/receipt.json" >/dev/null
jq -e '.dataLocation == "'"$tmp_root"'/first/runtime/alpha-service/data"' "$tmp_root/first/receipt.json" >/dev/null
jq -e '.mountSource == "'"$tmp_root"'/first/runtime/alpha-service/live"' "${state_dir}/kcml-repository-component-alpha-service.json" >/dev/null

STATE_DIR="$state_dir" "$bin_dir/podman" restart kcml-repository-component-alpha-service
test -f "$tmp_root/first/runtime/alpha-service/live/worker.sock"

setup_case update
seed_previous_runtime "$tmp_root/update/runtime/alpha-service" "sha256:$(printf 'c%.0s' {1..64})"
run_install "$tmp_root/update" success
jq -e '.previousImageDigest == "sha256:'"$(printf 'c%.0s' {1..64})"'"' "$tmp_root/update/receipt.json" >/dev/null
test -d "$tmp_root/update/runtime/alpha-service/previous-runtime"
test -d "$tmp_root/update/runtime/alpha-service/data"
test "$(jq -r '.imageDigest' "$tmp_root/update/receipt.json")" = "$(jq -r '.imageDigest' "${state_dir}/kcml-repository-component-alpha-service.json")"

setup_case candidate-fail
seed_previous_runtime "$tmp_root/candidate-fail/runtime/alpha-service" "sha256:$(printf 'd%.0s' {1..64})"
if run_install "$tmp_root/candidate-fail" candidate_fail; then
  echo "candidate failure scenario unexpectedly succeeded" >&2
  exit 1
fi
test ! -f "$tmp_root/candidate-fail/receipt.json"
jq -e '.imageDigest == "sha256:'"$(printf 'd%.0s' {1..64})"'"' "${state_dir}/kcml-repository-component-alpha-service.json" >/dev/null

setup_case live-fail
seed_previous_runtime "$tmp_root/live-fail/runtime/alpha-service" "sha256:$(printf 'e%.0s' {1..64})"
if run_install "$tmp_root/live-fail" live_fail; then
  echo "live failure scenario unexpectedly succeeded" >&2
  exit 1
fi
test ! -f "$tmp_root/live-fail/receipt.json"
jq -e '.imageDigest == "sha256:'"$(printf 'e%.0s' {1..64})"'"' "${state_dir}/kcml-repository-component-alpha-service.json" >/dev/null
test "$(readlink "$tmp_root/live-fail/runtime/alpha-service/live")" = "$tmp_root/live-fail/runtime/alpha-service/previous-runtime"

printf 'repository component deploy script checks passed\n'
