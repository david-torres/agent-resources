#!/bin/sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# .env may have CRLF line endings and quoted values, which sh can't source.
# Extract just the password and strip \r and surrounding quotes.
SUPABASE_DB_PASS="$(grep '^SUPABASE_DB_PASS=' "$DIR/.env" | cut -d= -f2- \
  | sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")"
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
