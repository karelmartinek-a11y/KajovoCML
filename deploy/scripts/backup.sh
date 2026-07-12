#!/usr/bin/env bash
set -euo pipefail

backup_dir="${BACKUP_DIR:-/opt/kcml/backups}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump "$DATABASE_URL" | gzip > "$backup_dir/kcml-$stamp.sql.gz"
echo "backup-created:$backup_dir/kcml-$stamp.sql.gz"
