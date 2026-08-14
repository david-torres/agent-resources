#!/usr/bin/env bash
#
# Rehearse this repo's pending migrations against a throwaway copy of a real
# database, and report what they would do -- before they do it anywhere that
# matters.
#
# WHY THIS EXISTS
#
# main's migration set never creates the core tables: its earliest migration is
# 20241213_collaborative_missions.sql, and profiles/characters/missions are
# created by none of them. Production's schema predates its own migration
# history. The refactor stack then added 20240101000000_baseline_schema.sql, a
# synthetic baseline dated before everything else so that a from-scratch
# `supabase db reset` works locally -- which it does, and which is why CI is
# green. That baseline has never met the production database. Ten of its 23
# CREATE TABLE statements are unguarded (profiles, characters, missions,
# lfg_posts among them), so against a database that already has those tables and
# no ledger entry for 20240101000000, the run aborts on the first one.
#
# It cannot destroy data -- every destructive statement in the baseline is a
# DROP POLICY IF EXISTS (47 of them) or DROP FUNCTION IF EXISTS increment. The
# risk is a deploy that dies partway through a ten-migration batch, and those 47
# policy drop-and-recreates silently replacing RLS that may have diverged.
#
# This script answers both questions with evidence instead of inference.
#
# WHAT IT DOES
#
#   1. Dumps the SOURCE database. Read-only: pg_dump and nothing else, ever.
#   2. Restores that dump into a scratch Postgres container on its own port.
#   3. Records the "before" schema and the full RLS policy set.
#   4. Applies every migration the source's ledger does not already list, in
#      version order, each in its own transaction, stopping at the first
#      failure -- the way the CLI would.
#   5. Diffs the policy set and reports the verdict.
#   6. Destroys the container.
#
# The source database is never written to. The local Supabase stack is never
# touched: the scratch container gets its own port and its own name, and the
# script refuses to start if that port is one the stack uses.
#
# USAGE
#
#   scripts/rehearse-migrations.sh --source local     # rehearse against a copy
#                                                     # of your dev database
#   scripts/rehearse-migrations.sh --source prod      # the real question
#
#   --with-data   copy table data too, not just schema. Slower, and it puts a
#                 copy of production on your disk until the container is
#                 destroyed -- but it is the only way to catch a migration that
#                 fails on the rows rather than on the shape (20260806000000
#                 rewrites an FK; a constraint can be valid against an empty
#                 table and rejected by real data).
#   --keep        leave the container running for inspection. Prints how to
#                 connect, and how to remove it when you are done.
#   --port N      scratch port (default 55432).
#   --forget V    delete version V from the restored ledger before applying, so
#                 the run treats it as pending. Repeatable. This is how you ask
#                 "what happens to a database that has the tables but never
#                 recorded the migration that creates them" -- production's exact
#                 situation -- without needing production:
#
#                   scripts/rehearse-migrations.sh --source local \
#                     --forget 20240101000000
#
#                 It edits the scratch copy's ledger. The source is untouched.
#
# For --source prod, supply the connection explicitly. Nothing is derived from a
# local .env, because in this repo SUPABASE_URL points at the local stack and
# silently rehearsing local-against-local would answer nothing:
#
#   REHEARSE_SOURCE_URL='postgresql://postgres.<ref>:<pass>@<region>.pooler.supabase.com:5432/postgres' \
#     scripts/rehearse-migrations.sh --source prod
#
# Or let it build that URL the way scripts/db-backup.sh does, from
# SUPABASE_URL (the project URL, not localhost), SUPABASE_DB_PASS and
# optionally SUPABASE_DB_REGION.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$DIR/supabase/migrations"

SOURCE=""
WITH_DATA=0
KEEP=0
PORT=55432
FORGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --with-data) WITH_DATA=1; shift ;;
    --keep) KEEP=1; shift ;;
    --forget) FORGET="$FORGET ${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,70p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$SOURCE" in
  local|prod) ;;
  *) echo "usage: $0 --source <local|prod> [--with-data] [--keep] [--port N]" >&2; exit 2 ;;
esac

# The local stack's ports. Binding the scratch container to one of these would
# collide with a running stack, and --port is exactly the kind of flag someone
# pastes without reading.
case "$PORT" in
  54321|54322|54323|54324|54327) echo "refusing --port $PORT: that belongs to the local Supabase stack" >&2; exit 2 ;;
esac

# Same image as the local stack, not a vanilla postgres: the baseline installs
# extensions (pgjwt, pg_graphql, ...) that only the Supabase image carries, and
# a rehearsal on an image without them would fail for a reason production never
# would.
IMAGE="$(docker ps --format '{{.Image}}' | grep -m1 '/supabase/postgres:' || true)"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.095}"

CONTAINER="migration-rehearsal-$$"
WORK="$(mktemp -d)"
trap 'rc=$?; if [ "$KEEP" = "1" ]; then
        echo; echo "--keep: scratch container left running."
        echo "  connect: psql postgresql://postgres:postgres@127.0.0.1:$PORT/postgres"
        echo "  remove : docker rm -f $CONTAINER"
      else
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
      fi
      rm -rf "$WORK"; exit $rc' EXIT

# ---------------------------------------------------------------- source URL

from_env_file() {
  [ -f "$DIR/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$DIR/.env" | head -n 1 |
    sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

if [ "$SOURCE" = "local" ]; then
  SOURCE_URL="$(supabase status -o env 2>/dev/null | sed -n 's/^DB_URL="\{0,1\}//p' | sed 's/"$//')"
  [ -n "$SOURCE_URL" ] || { echo "could not read DB_URL from \`supabase status\` -- is the local stack running?" >&2; exit 1; }
  SOURCE_LABEL="local dev database"
else
  SOURCE_URL="${REHEARSE_SOURCE_URL:-}"
  if [ -z "$SOURCE_URL" ]; then
    URL="${SUPABASE_URL:-$(from_env_file SUPABASE_URL)}"
    PASS="${SUPABASE_DB_PASS:-$(from_env_file SUPABASE_DB_PASS)}"
    REGION="${SUPABASE_DB_REGION:-$(from_env_file SUPABASE_DB_REGION)}"
    REGION="${REGION:-aws-0-us-east-1}"
    case "$URL" in
      ""|*127.0.0.1*|*localhost*)
        echo "--source prod needs a real project." >&2
        echo "SUPABASE_URL is '${URL:-unset}', which is not one. Set REHEARSE_SOURCE_URL to the" >&2
        echo "pooler connection string, or set SUPABASE_URL + SUPABASE_DB_PASS to the project's." >&2
        exit 2 ;;
    esac
    [ -n "$PASS" ] || { echo "SUPABASE_DB_PASS is not set (it is commented out in .env)" >&2; exit 2; }
    REF="$(printf '%s' "$URL" | sed -e 's|^https\{0,1\}://||' -e 's|/$||' -e 's|^db\.||' -e 's|\.supabase\.co.*$||')"
    SOURCE_URL="postgresql://postgres.$REF:$PASS@$REGION.pooler.supabase.com:5432/postgres"
  fi
  SOURCE_LABEL="production"
fi

# Belt and braces: whatever route produced the URL, a prod rehearsal must not be
# pointed at the local stack, and a local one must not reach out to a project.
case "$SOURCE:$SOURCE_URL" in
  prod:*127.0.0.1*|prod:*localhost*) echo "refusing: --source prod resolved to a local URL" >&2; exit 2 ;;
  local:*pooler.supabase.com*)       echo "refusing: --source local resolved to a remote URL" >&2; exit 2 ;;
esac

redacted() { printf '%s' "$1" | sed -E 's|://[^:]+:[^@]+@|://***:***@|'; }

echo "Rehearsing $DIR/supabase/migrations"
echo "  source : $SOURCE_LABEL -- $(redacted "$SOURCE_URL")"
echo "  scratch: $IMAGE on 127.0.0.1:$PORT"
echo "  data   : $([ "$WITH_DATA" = 1 ] && echo 'schema + data' || echo 'schema only')"
echo

# ------------------------------------------------------------ scratch server

echo "==> starting scratch Postgres"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres \
  --add-host=host.docker.internal:host-gateway \
  -p "127.0.0.1:$PORT:5432" "$IMAGE" >/dev/null

# -h 127.0.0.1 everywhere, deliberately. This image's entrypoint runs a
# throwaway init-phase server that listens on the unix socket ONLY, then shuts
# it down and starts the real one. A socket-based readiness probe passes against
# that first server, so a restore started on its say-so gets killed partway
# through with "the database system is shutting down" -- and silently, since the
# restore is allowed to report errors. Requiring TCP skips the init server
# entirely, because it never binds a port.
scratch() { docker exec -i "$CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

ready=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    # Twice in a row, a second apart: one success is not proof the restart is
    # behind us.
    ready=$((ready + 1))
    [ "$ready" -ge 2 ] && break
  else
    ready=0
  fi
  sleep 1
done
[ "$ready" -ge 2 ] || { echo "scratch Postgres never accepted TCP connections" >&2; exit 1; }

# ------------------------------------------------------------------ the dump
#
# Run pg_dump INSIDE the container: the client must match the server major, and
# a developer's system psql is routinely older (16 against a 17 server fails
# outright). --no-owner/--no-privileges because the scratch server has none of
# the source's roles.

# pg_dump runs inside the container, where 127.0.0.1 is the container's own
# loopback -- not the host's. A local source has to be reached via the
# host-gateway alias instead. Remote sources resolve normally and are untouched.
DUMP_URL="$(printf '%s' "$SOURCE_URL" | sed -e 's|@127\.0\.0\.1:|@host.docker.internal:|' -e 's|@localhost:|@host.docker.internal:|')"

echo "==> dumping source (read-only)"
# --clean --if-exists because the Supabase image pre-creates auth/storage/graphql
# schemas at init; without it the restore dies on "schema auth already exists"
# and the copy is never faithful.
DUMP_ARGS="--no-owner --no-privileges --clean --if-exists"
[ "$WITH_DATA" = 1 ] || DUMP_ARGS="$DUMP_ARGS --schema-only"

docker exec -i "$CONTAINER" pg_dump $DUMP_ARGS "$DUMP_URL" > "$WORK/source.sql" 2>"$WORK/dump.err" || {
  echo "pg_dump failed:" >&2; sed 's/^/    /' "$WORK/dump.err" >&2; exit 1; }

# The ledger decides which migrations are "pending", so it has to come across
# even on a schema-only run -- it is data, in a schema pg_dump would otherwise
# bring over empty.
docker exec -i "$CONTAINER" pg_dump --data-only --schema=supabase_migrations \
  "$DUMP_URL" > "$WORK/ledger.sql" 2>/dev/null || : > "$WORK/ledger.sql"

echo "    $(wc -l < "$WORK/source.sql") lines of schema, $(wc -l < "$WORK/ledger.sql") of ledger"

# Restored WITHOUT ON_ERROR_STOP, then verified by outcome. A dump of a Supabase
# database always produces some benign noise against a Supabase image -- roles it
# cannot drop, extensions already installed, ownership it was told to skip. What
# matters is whether the schema arrived, so that is what gets asserted rather
# than demanding a silent run and hiding the real errors among the expected ones.
echo "==> restoring into scratch"
docker exec -i "$CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -q < "$WORK/source.sql" > "$WORK/restore.log" 2>&1 || true
restore_errors="$(grep -c '^ERROR:' "$WORK/restore.log" || true)"

missing=""
for t in profiles characters missions; do
  present="$(scratch -tAq -c "select to_regclass('public.$t') is not null;" 2>/dev/null || echo f)"
  [ "$present" = "t" ] || missing="$missing $t"
done
if [ -n "$missing" ]; then
  echo "restore did not produce the core tables:$missing" >&2
  echo "first errors from the restore:" >&2
  grep '^ERROR:' "$WORK/restore.log" | head -10 | sed 's/^/    /' >&2
  exit 1
fi
[ "$restore_errors" = "0" ] || echo "    ($restore_errors benign restore error(s) -- core tables verified present)"
scratch -q < "$WORK/ledger.sql" >/dev/null 2>&1 || true
scratch -q -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key);" >/dev/null 2>&1

# ---------------------------------------------------------------- snapshots

POLICY_SQL="select schemaname||'.'||tablename||' :: '||policyname||' ['||cmd||'] using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-')
            from pg_policies where schemaname not in ('pg_catalog','information_schema') order by 1;"
TABLE_SQL="select table_schema||'.'||table_name from information_schema.tables
           where table_schema not in ('pg_catalog','information_schema') order by 1;"

for v in $FORGET; do
  n="$(scratch -tAq -c "delete from supabase_migrations.schema_migrations where version = '$v' returning 1;" | grep -c . || true)"
  if [ "$n" = "0" ]; then
    echo "    --forget $v: not in the ledger anyway (already pending)"
  else
    echo "    --forget $v: removed from the scratch ledger, will be treated as pending"
  fi
done
[ -n "$FORGET" ] && echo

scratch -tAq -c "$POLICY_SQL" > "$WORK/policies.before"
scratch -tAq -c "$TABLE_SQL"  > "$WORK/tables.before"
scratch -tAq -c "select version from supabase_migrations.schema_migrations order by version;" > "$WORK/ledger.before"

echo "    restored: $(wc -l < "$WORK/tables.before") tables, $(wc -l < "$WORK/policies.before") policies, $(wc -l < "$WORK/ledger.before") ledger entries"
echo

# ------------------------------------------------------------- apply pending

echo "==> applying pending migrations"
APPLIED=0; FAILED=""; SKIPPED=0
for file in "$MIGRATIONS"/*.sql; do
  version="$(basename "$file" | sed 's/_.*//')"
  if grep -qxF "$version" "$WORK/ledger.before"; then
    SKIPPED=$((SKIPPED + 1)); continue
  fi

  # --single-transaction so a failure leaves nothing half-applied, which is what
  # the CLI does and what makes the first failure the only one worth reporting.
  if docker exec -i "$CONTAINER" psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 \
       --single-transaction -q < "$file" > "$WORK/apply.log" 2>&1; then
    scratch -q -c "insert into supabase_migrations.schema_migrations(version) values ('$version') on conflict do nothing;" >/dev/null
    echo "    ok    $(basename "$file")"
    APPLIED=$((APPLIED + 1))
  else
    echo "    FAIL  $(basename "$file")"
    echo
    grep -E "^(psql:|ERROR|DETAIL|HINT|CONTEXT)" "$WORK/apply.log" | sed 's/^/        /' | head -12
    FAILED="$(basename "$file")"
    break
  fi
done
echo
echo "    $APPLIED applied, $SKIPPED already in the ledger$([ -n "$FAILED" ] && echo ", stopped at $FAILED")"
echo

# ----------------------------------------------------------------- the diff

scratch -tAq -c "$POLICY_SQL" > "$WORK/policies.after"
scratch -tAq -c "$TABLE_SQL"  > "$WORK/tables.after"

echo "==> what changed"
new_tables="$(comm -13 "$WORK/tables.before" "$WORK/tables.after" || true)"
gone_tables="$(comm -23 "$WORK/tables.before" "$WORK/tables.after" || true)"
[ -n "$new_tables" ]  && { echo "    tables added:"; printf '%s\n' "$new_tables" | sed 's/^/      + /'; }
[ -n "$gone_tables" ] && { echo "    TABLES REMOVED:"; printf '%s\n' "$gone_tables" | sed 's/^/      - /'; }
[ -z "$new_tables$gone_tables" ] && echo "    tables: unchanged"

# The 47 DROP POLICY IF EXISTS in the baseline are the quiet risk: they replace
# RLS wholesale, and a policy that changes shape shows up here as one removed
# and one added on the same table.
pol_added="$(comm -13 "$WORK/policies.before" "$WORK/policies.after" || true)"
pol_gone="$(comm -23 "$WORK/policies.before" "$WORK/policies.after" || true)"
if [ -z "$pol_added$pol_gone" ]; then
  echo "    RLS policies: unchanged"
else
  echo "    RLS policies: $(printf '%s' "$pol_gone" | grep -c . || true) removed/changed, $(printf '%s' "$pol_added" | grep -c . || true) added -- REVIEW THESE"
  [ -n "$pol_gone" ]  && printf '%s\n' "$pol_gone"  | sed 's/^/      - /' | head -25
  [ -n "$pol_added" ] && printf '%s\n' "$pol_added" | sed 's/^/      + /' | head -25
fi
echo

# ------------------------------------------------------------------ verdict

echo "==> verdict"
if [ -n "$FAILED" ]; then
  echo "    WOULD FAIL against $SOURCE_LABEL, at $FAILED."
  echo "    $APPLIED migration(s) would have applied first; a real deploy stops here."
  exit 1
fi
echo "    All $APPLIED pending migration(s) apply cleanly to a copy of $SOURCE_LABEL."
[ "$WITH_DATA" = 1 ] || echo "    Schema only -- rerun with --with-data to also prove them against the rows."
exit 0
