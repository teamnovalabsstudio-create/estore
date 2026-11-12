#!/usr/bin/env bash
# Nightly logical backup of the database and uploaded files. Run from cron on the VPS host:
#   15 22 * * * /opt/hikari/scripts/backup.sh >> /var/log/hikari-backup.log 2>&1
# Restore drill (do it monthly): see docs/RUNBOOK.md › Backups.
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hikari}"
STAMP="$(date -u +%Y%m%dT%H%MZ)"
COMPOSE="docker compose -f $(dirname "$0")/../docker-compose.prod.yml"
mkdir -p "$BACKUP_DIR"

$COMPOSE exec -T db pg_dump -U estore -d estore --format=custom --no-owner > "$BACKUP_DIR/db-$STAMP.dump"
docker run --rm -v hikari_uploads:/data:ro -v "$BACKUP_DIR":/out alpine tar czf "/out/uploads-$STAMP.tgz" -C /data .
echo "backup ok $STAMP"

# Retention — review, then uncomment to keep 14 days of local backups:
# find "$BACKUP_DIR" -type f -name '*-*Z.*' -mtime +14 -delete
#
# Off-site copy (strongly recommended):
# rclone copy "$BACKUP_DIR" remote:hikari-backups
