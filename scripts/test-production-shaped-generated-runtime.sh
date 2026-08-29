#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "production-shaped-generated-runtime:FAIL non-Linux runner" >&2
  exit 1
fi
selected_node_bin="${KCML_TEST_NODE_BIN:-$(command -v node || true)}"
test -n "$selected_node_bin" && test -x "$selected_node_bin"
selected_node_version="$("$selected_node_bin" --version)"
selected_node_major="${selected_node_version#v}"
selected_node_major="${selected_node_major%%.*}"
test "$selected_node_major" = 24
if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n env KCML_SANDBOX_TEST_ELEVATED=1 KCML_TEST_NODE_BIN="$selected_node_bin" KCML_TEST_NODE_VERSION="$selected_node_version" "$0" "$@"
fi
for command in systemctl systemd-run systemd-creds curl ps readlink; do
  command -v "$command" >/dev/null || { echo "production-shaped-generated-runtime:missing-command=$command" >&2; exit 1; }
done
pid1="$(ps -p 1 -o comm= | tr -d ' ')"
run_systemd=false
[ -d /run/systemd/system ] && run_systemd=true
systemd_state="$(systemctl is-system-running 2>&1 || true)"
echo "production-shaped-generated-runtime:environment:pid1=$pid1:run_systemd=$run_systemd:systemd_state=$systemd_state:systemctl=$(systemctl --version | head -n 1):systemd_run=$(systemd-run --version | head -n 1):systemd_creds=$(systemd-creds --version | head -n 1):uid=$(id -u)"
echo "production-shaped-generated-runtime:node:selected_node_path=$selected_node_bin:selected_node_version=$selected_node_version"
if [ "$pid1" != systemd ] || [ "$run_systemd" != true ] || ! systemctl is-system-running >/dev/null 2>&1; then
  echo "production-shaped-generated-runtime:BLOCKED functional systemd manager required" >&2
  exit 2
fi
for path in deploy/scripts/kcml-generated-runtime-helper deploy/systemd/kcml-generated-component@.service apps/server/src/generation/runtime-host.mjs apps/server/src/generation/handler-sandbox.mjs apps/server/src/generation/handler-sandbox-worker.mjs; do
  test -e "$path" || { echo "production-shaped-generated-runtime:missing-path=$path" >&2; exit 1; }
done
test -x deploy/scripts/kcml-generated-runtime-helper
test -x /usr/bin/unshare
test -x /usr/bin/mount
test -x /usr/sbin/chroot

component_code="kcml$(printf '%04d' $((1000 + ($$ % 8000))))"
component_root="/var/lib/kcml/generated-components/$component_code"
release_root="$component_root/releases/systemd-test-$$"
socket_path="/var/lib/kcml/runtime/$component_code.sock"
unit="kcml-generated-component@${component_code}.service"
unit_file="/etc/systemd/system/kcml-generated-component@.service"
dropin_dir="/etc/systemd/system/kcml-generated-component@.service.d"
dropin_file="$dropin_dir/ci-node-path.conf"
unit_backup="$(mktemp)"
had_unit=false
dropin_created=false
created_group=false
created_owner_user=false
created_user=false
if [ -e "$unit_file" ]; then cp -p "$unit_file" "$unit_backup"; had_unit=true; fi
runtime_token="kca_$(printf '%096d' "$$")"
rotated_token="kca_$(printf '%096d' "$(( $$ + 1 ))")"

cleanup() {
  set +e
  systemctl stop "$unit" >/dev/null 2>&1
  systemctl reset-failed "$unit" >/dev/null 2>&1
  rm -rf "$component_root" "$socket_path"
  if [ "$had_unit" = true ]; then cp -p "$unit_backup" "$unit_file"; else rm -f "$unit_file"; fi
  if [ "$dropin_created" = true ]; then rm -f "$dropin_file"; fi
  rmdir "$dropin_dir" >/dev/null 2>&1 || true
  rm -f "$unit_backup"
  systemctl daemon-reload >/dev/null 2>&1
  if [ "$created_user" = true ]; then userdel kcml-runtime >/dev/null 2>&1; fi
  if [ "$created_owner_user" = true ]; then userdel kcml >/dev/null 2>&1; fi
  if [ "$created_group" = true ]; then groupdel kcml >/dev/null 2>&1; fi
}
trap cleanup EXIT

cp deploy/systemd/kcml-generated-component@.service "$unit_file"
node_bin="$selected_node_bin"
test -x "$node_bin"
test "$("$node_bin" --version)" = "$selected_node_version"
test "${node_bin##*/}" = node
if [ "$node_bin" != /usr/bin/node ]; then
  mkdir -p "$dropin_dir"
  if [ -e "$dropin_file" ]; then
    echo "production-shaped-generated-runtime:unexpected-existing-ci-dropin" >&2
    exit 1
  fi
  cat >"$dropin_file" <<EOF
[Service]
ExecStart=
ExecStart=$node_bin $component_root/current/runtime-host.mjs
EOF
  dropin_created=true
fi
systemctl daemon-reload
if ! getent group kcml >/dev/null; then
  groupadd --system kcml
  created_group=true
fi
if ! id kcml >/dev/null 2>&1; then
  useradd --system --gid kcml --home-dir /nonexistent --shell /usr/sbin/nologin kcml
  created_owner_user=true
elif [ "$(id -gn kcml)" != kcml ]; then
  echo "production-shaped-generated-runtime:existing-owner-group-mismatch" >&2
  exit 1
fi
if ! id kcml-runtime >/dev/null 2>&1; then
  useradd --system --gid kcml --home-dir /nonexistent --shell /usr/sbin/nologin kcml-runtime
  created_user=true
elif [ "$(id -gn kcml-runtime)" != kcml ]; then
  echo "production-shaped-generated-runtime:existing-user-group-mismatch" >&2
  exit 1
fi
runuser -u kcml-runtime -- /usr/bin/setpriv --no-new-privs /usr/bin/unshare --user --map-root-user --mount --net --ipc --uts --pid --fork --kill-child=SIGKILL /bin/true
echo "production-shaped-generated-runtime:user_namespace_probe=PASS"
deploy/scripts/kcml-generated-runtime-helper prepare "$component_code"
mkdir -p "$release_root"
cp apps/server/src/generation/runtime-host.mjs apps/server/src/generation/handler-sandbox.mjs apps/server/src/generation/handler-sandbox-worker.mjs "$release_root/"
cat >"$release_root/handler.mjs" <<'HANDLER'
export const tools=[{name:"echo",title:"Echo",description:"Production-shaped echo",inputSchema:{type:"object",properties:{value:{}},required:["value"],additionalProperties:false},outputSchema:{type:"object",additionalProperties:true}},{name:"stateStore",title:"State store",description:"Persistent state",inputSchema:{type:"object",properties:{value:{}},required:["value"],additionalProperties:false},outputSchema:{type:"object",additionalProperties:true}},{name:"stateRead",title:"State read",description:"Persistent state",inputSchema:{type:"object",additionalProperties:false},outputSchema:{type:"object",additionalProperties:true}}];
export async function invoke(name,args,context){if(name==="echo")return {value:args.value};if(name==="stateStore"){await context.state.set("systemd-test",{value:args.value});return {stored:true};}if(name==="stateRead")return {value:await context.state.get("systemd-test")};throw new Error("tool_not_found");}
export async function states(){return {runtime:"systemd"};}
HANDLER
cat >"$component_root/runtime.env" <<EOF
KCML_RUNTIME_SOCKET=$socket_path
KCML_COMPONENT_CODE=$component_code
KCML_HANDLER_PATH=$component_root/current/handler.mjs
KCML_STATE_DIR=$component_root/data
KCML_SECRET_API_BASE=https://secrets.example.invalid
KCML_COMPONENT_HOSTNAME=\${component_code}.kajovocml.hcasc.cz
EOF
ln -sfn "$release_root" "$component_root/current"
chown -R root:kcml "$component_root"
chmod -R g=rX,o= "$component_root"
chown -R kcml-runtime:kcml "$component_root/data"
printf '%s\n' "$runtime_token" | deploy/scripts/kcml-generated-runtime-helper credential-stdin "$component_code"

if ! systemctl start "$unit"; then
  systemctl status "$unit" --no-pager -l >&2 || true
  journalctl -u "$unit" -n 80 --no-pager -o cat >&2 || true
  exit 1
fi
for _attempt in $(seq 1 40); do
  if [ "$(systemctl is-active "$unit" 2>/dev/null || true)" = active ] && [ "$(curl --silent --show-error --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' http://localhost/health 2>/dev/null || true)" = 200 ]; then break; fi
  systemctl is-failed --quiet "$unit" && { systemctl status "$unit" --no-pager -l >&2; exit 1; }
  sleep 0.25
done
if [ "$(systemctl is-active "$unit")" != active ]; then
  systemctl status "$unit" --no-pager -l >&2 || true
  journalctl -u "$unit" -n 80 --no-pager -o cat >&2 || true
  exit 1
fi
if [ "$(curl --silent --show-error --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' http://localhost/ready 2>/dev/null || true)" != 200 ]; then
  echo "production-shaped-generated-runtime:readiness-socket=$socket_path" >&2
  ls -la "$(dirname "$socket_path")" >&2 || true
  systemctl status "$unit" --no-pager -l >&2 || true
  journalctl -u "$unit" -n 80 --no-pager -o cat >&2 || true
  exit 1
fi
runtime_pid="$(systemctl show "$unit" --property=MainPID --value)"
test "$(ps -o user= -p "$runtime_pid" | tr -d ' ')" = kcml-runtime
test "$(ps -o group= -p "$runtime_pid" | tr -d ' ')" = kcml
runtime_process_node_path="$(readlink -f "/proc/$runtime_pid/exe")"
test "$runtime_process_node_path" = "$(readlink -f "$node_bin")"
request() { curl --silent --show-error --fail --unix-socket "$socket_path" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3" "http://localhost$2"; }
printf '%s' "$(request "$runtime_token" /mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')" | jq -e '.result.tools[0].name == "echo"' >/dev/null
printf '%s' "$(request "$runtime_token" /mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"value":"systemd"}}}')" | jq -e '.result.structuredContent.value == "systemd"' >/dev/null
printf '%s' "$(request "$runtime_token" /mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"stateStore","arguments":{"value":"persisted"}}}')" | jq -e '.result.structuredContent.stored == true' >/dev/null
printf '%s' "$(request "$runtime_token" /v1/kcml/runtime/storage-probe '{}')" | jq -e '.persistent == true' >/dev/null
systemd_exec_node_path="$node_bin"
runtime_process_node_version="$("$runtime_process_node_path" --version)"
runtime_process_node_major="${runtime_process_node_version#v}"
runtime_process_node_major="${runtime_process_node_major%%.*}"
test "$runtime_process_node_major" = 24
echo "production-shaped-generated-runtime:unit=PASS:user=kcml-runtime:group=kcml:credential=LoadCredentialEncrypted:load_credential_encrypted_configured=true:load_credential_encrypted_manager_handoff=true:runtime_credential_consumed=true:systemd_exec_node_path=$systemd_exec_node_path:runtime_process_node_path=$runtime_process_node_path:runtime_process_node_version=$runtime_process_node_version:handler=sandboxed"

systemctl restart "$unit"
for _attempt in $(seq 1 40); do
  [ "$(systemctl is-active "$unit" 2>/dev/null || true)" = active ] && [ "$(curl --silent --show-error --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' http://localhost/ready 2>/dev/null || true)" = 200 ] && break
  sleep 0.25
done
test "$(systemctl is-active "$unit")" = active
printf '%s' "$(request "$runtime_token" /mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"value":"restart"}}}')" | jq -e '.result.structuredContent.value == "restart"' >/dev/null
printf '%s' "$(request "$runtime_token" /mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"stateRead","arguments":{}}}')" | jq -e '.result.structuredContent.value.value == "persisted"' >/dev/null
printf '%s\n' "$rotated_token" | deploy/scripts/kcml-generated-runtime-helper credential-stdin "$component_code"
systemctl restart "$unit"
for _attempt in $(seq 1 40); do
  [ "$(systemctl is-active "$unit" 2>/dev/null || true)" = active ] && [ "$(curl --silent --show-error --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' http://localhost/ready 2>/dev/null || true)" = 200 ] && break
  sleep 0.25
done
test "$(curl --silent --show-error --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $runtime_token" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}' http://localhost/mcp)" = 401
test "$(curl --silent --show-error --unix-socket "$socket_path" -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $rotated_token" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":5,"method":"tools/list","params":{}}' http://localhost/mcp)" = 200
echo "production-shaped-generated-runtime:restart=PASS:persistence=PASS:credential-rotation=PASS:cleanup=TRAP"
