#!/usr/bin/env bash
# V16 (slow): operations against a real PostgreSQL.
#
# Throw-away database gymtime_ops_check_<pid> (and a second one for the
# restore): migrations, backfill re-run, key rotation with interruption and
# verification, advisory-lock election, backup -> restore into a clean database
# (same counts, every template decrypts, a wrong key does not) and the safety
# refusals of restore.sh. Never touches the development database.
#
#   npm run test:ops-db
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$HERE/.."
DEPLOY="$HERE/../../deploy"
ROOT_ENV="$HERE/../../.env"

if [[ -z "${DATABASE_URL:-}" && -f "$ROOT_ENV" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT_ENV" | head -n1 | cut -d= -f2- | tr -d '"')"
fi
[[ -n "${DATABASE_URL:-}" ]] || { echo "SKIP: DATABASE_URL is not set; nothing verified." >&2; exit 0; }
for tool in psql pg_dump pg_restore; do
  command -v "$tool" >/dev/null || { echo "SKIP: $tool is not installed; nothing verified." >&2; exit 0; }
done

BASE_URL="${DATABASE_URL%%\?*}"
SERVER_URL="${BASE_URL%/*}"
ADMIN_URL="$SERVER_URL/postgres"
DB="gymtime_ops_check_$$"
RESTORED="gymtime_ops_check_${$}_restored"
psql "$ADMIN_URL" -qtAc 'select 1' >/dev/null 2>&1 || { echo "SKIP: cannot connect to PostgreSQL; nothing verified." >&2; exit 0; }

WORK="$(mktemp -d)"
cleanup() {
  for d in "$DB" "$RESTORED"; do
    psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
}
trap cleanup EXIT
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$DB\"" >/dev/null
fail() { echo "FAIL: $*" >&2; exit 1; }

cd "$SERVER"
export DATABASE_URL="$SERVER_URL/$DB"
export V16_OLD_KEY V16_NEW_KEY
V16_OLD_KEY="$(openssl rand -base64 32)"
V16_NEW_KEY="$(openssl rand -base64 32)"

echo "== Migrations and backfill re-run =="
npx prisma migrate deploy >/dev/null
echo "ok   migrations applied"
BACKFILL="$(ls prisma/migrations/*h11_schedule_validity_backfill/migration.sql)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$BACKFILL" >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$BACKFILL" >/dev/null
echo "ok   backfill is idempotent"

echo "== Key rotation and leader lock =="
V16_PHASE=live npx vitest run --config ./vitest.config.ops-db.ts

echo "== Backup -> restore into a clean database =="
BACKUP_DIR="$WORK/backups" "$DEPLOY/backup.sh" >/dev/null
DUMP="$(ls "$WORK"/backups/*.dump | head -n1)"
[[ -s "$DUMP" ]] || fail "no dump produced"
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$RESTORED\"" >/dev/null
RESTORE_SKIP_MIGRATE=1 "$DEPLOY/restore.sh" "$DUMP" "$SERVER_URL/$RESTORED" >/dev/null
echo "ok   restored"
# A non-empty target and the live database must be refused.
if RESTORE_SKIP_MIGRATE=1 "$DEPLOY/restore.sh" "$DUMP" "$SERVER_URL/$RESTORED" >/dev/null 2>&1; then
  fail "restore.sh overwrote a non-empty database"
fi
echo "ok   restore.sh refuses a non-empty target"
if RESTORE_SKIP_MIGRATE=1 DATABASE_URL="$SERVER_URL/$RESTORED" "$DEPLOY/restore.sh" "$DUMP"  "$SERVER_URL/$RESTORED" >/dev/null 2>&1; then
  fail "restore.sh restored over the live database without a clear refusal"
fi
echo "ok   restore.sh refuses the live database"
DATABASE_URL="$SERVER_URL/$RESTORED" V16_PHASE=restored npx vitest run --config ./vitest.config.ops-db.ts

echo "V16 passed."
