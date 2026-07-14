#!/usr/bin/env bash
set -euo pipefail
umask 077

workdir="$(mktemp -d)"
port="${KCML_ALERT_SINK_TEST_PORT:-33011}"
cleanup() {
  if [ -n "${sink_pid:-}" ]; then kill "$sink_pid" 2>/dev/null || true; wait "$sink_pid" 2>/dev/null || true; fi
  rm -rf "$workdir"
}
trap cleanup EXIT

raw_key="$(openssl rand -hex 32)"
printf '%s' "$raw_key" | base64 > "$workdir/key"
PORT="$port" \
ALERT_SINK_CHANNEL=PRIMARY \
ALERT_SINK_STATE_DIR="$workdir/state" \
ALERT_SINK_HMAC_KEY_BASE64_FILE="$workdir/key" \
  node deploy/alert-sink/receiver.mjs >"$workdir/stdout" 2>"$workdir/stderr" &
sink_pid=$!
for _attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$port/health" | grep -F '"status":"ok"' >/dev/null

body='{"alertId":"00000000-0000-0000-0000-000000000001","correlationId":"00000000-0000-0000-0000-000000000002","severity":"CRITICAL"}'
timestamp="$(date +%s)"
signature="$(printf '%s' "$timestamp.$body" | openssl dgst -sha256 -hmac "$raw_key" -hex | awk '{print $2}')"
for _attempt in 1 2; do
  test "$(curl -sS -o "$workdir/response" -w '%{http_code}' -X POST "http://127.0.0.1:$port/kcml-alert" \
    -H 'content-type: application/json' \
    -H 'x-kcml-delivery-id: 00000000-0000-0000-0000-000000000003' \
    -H "x-kcml-timestamp: $timestamp" \
    -H "x-kcml-signature: v1=$signature" \
    --data "$body")" = 200
done
test "$(curl -sS -o "$workdir/invalid" -w '%{http_code}' -X POST "http://127.0.0.1:$port/kcml-alert" \
  -H 'x-kcml-delivery-id: 00000000-0000-0000-0000-000000000004' \
  -H "x-kcml-timestamp: $timestamp" \
  -H 'x-kcml-signature: v1=0000000000000000000000000000000000000000000000000000000000000000' \
  --data "$body")" = 401
test "$(find "$workdir/state" -type f | wc -l | tr -d ' ')" = 1
jq -e '.channel=="PRIMARY" and .payload.severity=="CRITICAL"' \
  "$workdir/state/00000000-0000-0000-0000-000000000003.json" >/dev/null
echo "alert-sink-ok"
