#!/bin/sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$DIR/.env"
mkdir -p "$DIR/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
PGPASSWORD="$SUPABASE_DB_PASS" pg_dump \
  -h aws-0-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.ndneltuukvijkvdfaqfu \
  -d postgres \
  -F c \
  -f "$DIR/backups/backup-$STAMP.dump"
echo "Backup saved to backups/backup-$STAMP.dump"
