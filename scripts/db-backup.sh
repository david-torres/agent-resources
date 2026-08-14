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
: "${SUPABASE_DB_PASS:?must be set in the environment or .env (it ships commented out)}"

PROJECT_REF=$(printf '%s' "$SUPABASE_URL" |
  sed -e 's|^https\{0,1\}://||' -e 's|/$||' -e 's|^db\.||' -e 's|\.supabase\.co.*$||')
REGION="${SUPABASE_DB_REGION:-aws-0-us-east-1}"

case "$SUPABASE_URL" in
  *127.0.0.1*|*localhost*)
    echo "SUPABASE_URL points at the local stack ($SUPABASE_URL)." >&2
    echo "This script backs up the hosted project. Set SUPABASE_URL to it, or use" >&2
    echo "  supabase db dump  for the local one." >&2
    exit 2 ;;
esac

mkdir -p "$DIR/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/backups/backup-$STAMP.dump"
# Written to .partial and renamed only once it verifies. A failed dump used to
# leave a zero-byte file sitting in backups/ named exactly like a real one.
PARTIAL="$OUT.partial"
trap 'rm -f "$PARTIAL"' EXIT

HOST="$REGION.pooler.supabase.com"
USER="postgres.$PROJECT_REF"

# pg_dump refuses to dump a server NEWER than itself ("aborting because of server
# version mismatch"), and distro packages lag: Ubuntu 24.04 ships 16.x while
# Supabase projects run 17.x. That failure is silent in the worst way -- it comes
# after you have decided you have a backup.
#
# So: use the local pg_dump when it is new enough, and otherwise dump through a
# container image whose pg_dump matches. An OLDER server is fine either way; only
# a newer one is a problem.
# Anchored at the start on purpose: `pg_dump (PostgreSQL) 16.14 (Ubuntu
# 16.14-0ubuntu0.24.04.1)` ends in another dotted number, and a greedy pattern
# reads the major as "04".
LOCAL_MAJOR=$(pg_dump --version 2>/dev/null | sed -n 's/^pg_dump (PostgreSQL) \([0-9][0-9]*\).*/\1/p')
IMAGE="${BACKUP_PGDUMP_IMAGE:-$(docker ps --format '{{.Image}}' 2>/dev/null | grep -m1 '/supabase/postgres:' || true)}"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.095}"
IMAGE_MAJOR=$(printf '%s' "$IMAGE" | sed -n 's/.*postgres:\([0-9][0-9]*\)\..*/\1/p')

dump_local() {
  PGPASSWORD="$SUPABASE_DB_PASS" pg_dump \
    -h "$HOST" -p 5432 -U "$USER" -d postgres -F c -f "$PARTIAL"
}

# The password goes in an --env-file, not -e: docker's arguments are visible in
# `ps` to every user on the machine, and a project's database password is not
# something to leak to a process listing. The shell-level assignment in
# dump_local() is not in pg_dump's argv, so it has never had this problem.
dump_container() {
  ENVFILE="$(mktemp)"
  chmod 600 "$ENVFILE"
  printf 'PGPASSWORD=%s\n' "$SUPABASE_DB_PASS" > "$ENVFILE"
  # shellcheck disable=SC2064
  trap "rm -f '$ENVFILE' \"$PARTIAL\"" EXIT
  docker run --rm -i --env-file "$ENVFILE" --entrypoint pg_dump "$IMAGE" \
    -h "$HOST" -p 5432 -U "$USER" -d postgres -F c > "$PARTIAL"
  rm -f "$ENVFILE"
  trap 'rm -f "$PARTIAL"' EXIT
}

USED_CONTAINER=0
if [ -n "$LOCAL_MAJOR" ] && [ -n "$IMAGE_MAJOR" ] && [ "$LOCAL_MAJOR" -lt "$IMAGE_MAJOR" ]; then
  if command -v docker >/dev/null 2>&1; then
    USED_CONTAINER=1
    echo "local pg_dump is $LOCAL_MAJOR, project is likely $IMAGE_MAJOR -- dumping via $IMAGE"
    dump_container
  else
    echo "local pg_dump is $LOCAL_MAJOR but the project is likely $IMAGE_MAJOR, and pg_dump" >&2
    echo "refuses to dump a newer server. Install postgresql-client-$IMAGE_MAJOR, or install" >&2
    echo "Docker so this script can dump through a matching image." >&2
    exit 1
  fi
elif [ -z "$LOCAL_MAJOR" ]; then
  command -v docker >/dev/null 2>&1 || { echo "neither pg_dump nor docker is available" >&2; exit 1; }
  echo "no local pg_dump -- dumping via $IMAGE"
  USED_CONTAINER=1
  dump_container
else
  dump_local
fi

# "It wrote a file" is not "you have a backup". A custom-format archive that
# pg_restore cannot read its way through is worth knowing about now rather than
# during a restore.
#
# Verified with the SAME pg_restore that matches the dump. pg_restore has
# pg_dump's version rule -- a 16 client cannot read a 17 archive -- so verifying
# a container-produced dump with the local binary reports a perfectly good backup
# as corrupt.
if [ "$USED_CONTAINER" = "1" ]; then
  ENTRIES=$(docker run --rm -i --entrypoint pg_restore "$IMAGE" --list < "$PARTIAL" 2>/dev/null | grep -c . || true)
elif command -v pg_restore >/dev/null 2>&1; then
  ENTRIES=$(pg_restore --list "$PARTIAL" 2>/dev/null | grep -c . || true)
else
  ENTRIES=""
fi

if [ ! -s "$PARTIAL" ]; then
  echo "the dump produced no data; treat this as a failed backup" >&2
  exit 1
fi

if [ -n "$ENTRIES" ] && [ "$ENTRIES" -gt 0 ]; then
  mv "$PARTIAL" "$OUT"; trap - EXIT
  echo "Backup saved to backups/backup-$STAMP.dump ($(du -h "$OUT" | cut -f1), $ENTRIES archive entries)"
elif [ -z "$ENTRIES" ]; then
  mv "$PARTIAL" "$OUT"; trap - EXIT
  echo "Backup saved to backups/backup-$STAMP.dump ($(du -h "$OUT" | cut -f1))"
  echo "  (no pg_restore available to verify it is readable)" >&2
else
  echo "the dump is not a readable archive; treat this as a failed backup" >&2
  exit 1
fi

# Reminder, because a pg_dump is not a project backup: Storage FILES live outside
# Postgres. storage.objects rows are in here; the uploaded bytes they point at
# are not.
