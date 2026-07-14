#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_dir="${BACKUP_DIR:-/opt/kcml/backups}"
recipient_file="${AGE_RECIPIENT_FILE:-/etc/kcml/backup.age.recipient}"
retention_days="${BACKUP_RETENTION_DAYS:-35}"

test -r "$recipient_file"
command -v age >/dev/null
command -v pg_dump >/dev/null
install -d -m 0700 "$backup_dir"
find "$backup_dir" -maxdepth 1 -type f -exec chmod 0600 {} +

recipient="$(tr -d '[:space:]' < "$recipient_file")"
case "$recipient" in
  age1*) ;;
  *) echo "invalid age recipient" >&2; exit 1 ;;
esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
encrypted="$backup_dir/kcml-$stamp.dump.age"
plain="$(mktemp "$backup_dir/.kcml-$stamp.XXXXXX.dump")"
trap 'rm -f "$plain"' EXIT

pg_dump --format=custom --no-owner --no-privileges --file "$plain" "$DATABASE_URL"
age --recipient "$recipient" --output "$encrypted" "$plain"
sha256sum "$encrypted" > "$encrypted.sha256"
chmod 0600 "$encrypted" "$encrypted.sha256"
rm -f "$plain"
trap - EXIT

find "$backup_dir" -maxdepth 1 -type f -name 'kcml-*.dump.age' -mtime "+$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'kcml-*.dump.age.sha256' -mtime "+$retention_days" -delete
echo "backup-created:$encrypted"
