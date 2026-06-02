#!/usr/bin/env bash
# Nightly DB backup — timestamped, gzipped pg_dump from the postgres container.
# Cron example (server):  0 2 * * *  /opt/warehouse14/scripts/backup.sh
set -euo pipefail

DIR="${BACKUP_DIR:-/opt/warehouse14/backups}"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/warehouse14-$STAMP.sql.gz"

docker exec warehouse14-postgres pg_dump -U warehouse14 -d warehouse14 --no-owner \
  | gzip > "$OUT"

echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Keep the last 14; prune older.
ls -1t "$DIR"/warehouse14-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "[backup] pruned to the 14 most recent."

# Off-site (recommended): also push $OUT to R2/object storage, e.g. via rclone.
