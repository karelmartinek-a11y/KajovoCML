#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

release_id="${1:?release id required}"
[[ "$release_id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid release id" >&2; exit 2; }
test "$(id -u)" = 0
app_database_url="$(cat /etc/kcml/database-app.url)"
correlation="$(cat /proc/sys/kernel/random/uuid)"
alert_id="$(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --set ON_ERROR_STOP=1 \
  --set correlation="$correlation" --set release_id="$release_id" <<'SQL' | tail -n 1
begin;
update operational_alert set status='CLOSED',closed_at=now()
 where alert_type='deployment.webhook_test' and status in ('OPEN','ACKNOWLEDGED','SUPPRESSED');
insert into operational_alert(severity,alert_type,title,detail,correlation_id)
values ('CRITICAL','deployment.webhook_test','KCML deployment webhook test',jsonb_build_object('buildId', :'release_id'),:'correlation'::uuid)
returning id \gset
insert into alert_webhook_delivery(alert_id,channel,idempotency_key)
values (:'id','PRIMARY',gen_random_uuid()),(:'id','BACKUP',gen_random_uuid());
select append_audit_event('deployment.webhook_test.opened','deployment',null,'operational_alert',:'id',null,
  jsonb_build_object('buildId', :'release_id'),:'correlation'::uuid);
commit;
\echo :id
SQL
)"
[[ "$alert_id" =~ ^[0-9a-f-]{36}$ ]]
cleanup() {
  psql "$app_database_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --set alert_id="$alert_id" --set correlation="$correlation" --set release_id="$release_id" <<'SQL' >/dev/null
begin;
update operational_alert set status='CLOSED',closed_at=now(),last_seen_at=now() where id=:'alert_id';
select append_audit_event(
  'deployment.webhook_test.closed','deployment',null,'operational_alert',:'alert_id',null,
  jsonb_build_object('buildId', :'release_id'),:'correlation'::uuid
);
commit;
SQL
}
trap cleanup EXIT
for _attempt in $(seq 1 75); do
  if [ "$(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --command "select count(*) from alert_webhook_delivery where alert_id='$alert_id' and state='DELIVERED' and last_http_status=200")" = "2" ]; then break; fi
  sleep 2
done
test "$(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --command "select count(*) from alert_webhook_delivery where alert_id='$alert_id' and state='DELIVERED' and last_http_status=200")" = "2"
while IFS='|' read -r channel delivery_id; do
  case "$channel" in
    PRIMARY) test -s "/var/lib/kcml/alert-primary-sink/$delivery_id.json" ;;
    BACKUP) test -s "/var/lib/kcml/alert-backup-sink/$delivery_id.json" ;;
    *) exit 1 ;;
  esac
done < <(psql "$app_database_url" --no-psqlrc --tuples-only --no-align --quiet --command "select channel,idempotency_key from alert_webhook_delivery where alert_id='$alert_id' order by channel")
echo "webhook-acceptance:primary=PASS:backup=PASS:alert=$alert_id"
