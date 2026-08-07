#!/bin/sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Read a key from .env, for values not already set in the environment.
from_env_file() {
  [ -f "$DIR/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$DIR/.env" | head -n 1 |
    sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

SUPABASE_URL="${SUPABASE_URL:-$(from_env_file SUPABASE_URL)}"
SUPABASE_DB_PASS="${SUPABASE_DB_PASS:-$(from_env_file SUPABASE_DB_PASS)}"
SUPABASE_DB_REGION="${SUPABASE_DB_REGION:-$(from_env_file SUPABASE_DB_REGION)}"

: "${SUPABASE_URL:?must be set in the environment or .env}"
: "${SUPABASE_DB_PASS:?must be set in the environment or .env}"

PROJECT_REF=$(printf '%s' "$SUPABASE_URL" |
  sed -e 's|^https\{0,1\}://||' -e 's|/$||' -e 's|^db\.||' -e 's|\.supabase\.co.*$||')
REGION="${SUPABASE_DB_REGION:-aws-0-us-east-1}"

mkdir -p "$DIR/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
PGPASSWORD="$SUPABASE_DB_PASS" pg_dump \
  -h "$REGION.pooler.supabase.com" \
  -p 5432 \
  -U "postgres.$PROJECT_REF" \
  -d postgres \
  -F c \
  -f "$DIR/backups/backup-$STAMP.dump"
echo "Backup saved to backups/backup-$STAMP.dump"
