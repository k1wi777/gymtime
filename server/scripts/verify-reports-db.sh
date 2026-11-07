#!/usr/bin/env bash
# V15 (slow): the report reads against a real PostgreSQL.
#
# Creates a throw-away database, migrates it, runs the repository contract of
# the report reads on Prisma, seeds the simulated semester x20, times every
# report against the 1.5 s budget (and checks it against the oracle) and
# prints the EXPLAIN plans of the access patterns, failing if one of them
# cannot use an index. Needs PostgreSQL (docker compose up -d) and `psql`.
# Outside `rei check`: it touches a real database server, but never the
# development database: the name is gymtime_reports_check_<pid>.
#
#   npm run test:reports-db           (from the repo root or from server/)
#   DATABASE_URL=postgresql://... npm run test:reports-db
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$HERE/.."
ROOT_ENV="$HERE/../../.env"
SCALE="${V15_SCALE:-20}"

if [[ -z "${DATABASE_URL:-}" && -f "$ROOT_ENV" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT_ENV" | head -n1 | cut -d= -f2- | tr -d '"')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "SKIP: DATABASE_URL is not set (and there is no .env); nothing verified." >&2
  exit 0
fi
if ! command -v psql >/dev/null; then
  echo "SKIP: psql is not installed; nothing verified." >&2
  exit 0
fi

BASE_URL="${DATABASE_URL%%\?*}"
SERVER_URL="${BASE_URL%/*}"
TEMP_DB="gymtime_reports_check_$$"
ADMIN_URL="$SERVER_URL/postgres"
TEMP_URL="$SERVER_URL/$TEMP_DB"

if ! psql "$ADMIN_URL" -qtAc 'select 1' >/dev/null 2>&1; then
  echo "SKIP: cannot connect to PostgreSQL (is 'docker compose up -d' running?); nothing verified." >&2
  exit 0
fi

SEED_DB="gymtime_seed_dev_check_$$"
SEED_URL="$SERVER_URL/$SEED_DB"
cleanup() {
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$TEMP_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SEED_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$TEMP_DB\"" >/dev/null

sql() { psql "$TEMP_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cd "$SERVER"
export DATABASE_URL="$TEMP_URL"

echo "== Migrations =="
npx prisma migrate deploy >/dev/null
echo "ok   migrations applied"

echo "== Contract of the report reads on PostgreSQL =="
V15_PHASE=contract npx vitest run --config ./vitest.config.reports-db.ts

echo "== Simulated semester x$SCALE =="
# The contract leaves its own rows behind; the oracle needs only the semester.
sql -c "TRUNCATE students, periods, schedules, schedule_instances, schedule_students, attendance_sessions, alarm_events CASCADE"
npx nest build >/dev/null
SEED_ALLOW="$TEMP_DB" node dist/reports/seed/run-seed.js --scale "$SCALE" --reset | head -n 12
sql -c "ANALYZE"
echo "sessions: $(sql -c 'SELECT count(*) FROM attendance_sessions')"

echo "== Time budget and oracle =="
V15_PHASE=perf V15_SCALE="$SCALE" npx vitest run --config ./vitest.config.reports-db.ts

echo "== Execution plans (an index must be usable) =="
RANGE="fecha BETWEEN '2026-02-02' AND '2026-05-29'"
check_plan() { # check_plan <label> <query>
  local plan
  plan="$(sql -c "SET enable_seqscan = off; EXPLAIN $2" | tr -d '\r')"
  if grep -q "Seq Scan" <<<"$plan"; then
    echo "$plan" >&2
    fail "$1: the plan needs a sequential scan (no usable index)"
  fi
  echo "ok   $1 -> $(grep -oE '(Index( Only)? Scan|Bitmap Index Scan) using [a-z_]+|Bitmap Index Scan on [a-z_]+' <<<"$plan" | sort -u | tr '\n' ' ')"
  # Informative: what the planner picks by itself on this volume.
  if sql -c "EXPLAIN $2" | grep -q "Seq Scan"; then
    echo "     (by default PostgreSQL still prefers a Seq Scan at this size; the index exists and is usable)"
  fi
}
check_plan "schedule_instances by date" \
  "SELECT * FROM schedule_instances WHERE $RANGE"
check_plan "attendance_sessions by occurrences" \
  "SELECT * FROM attendance_sessions WHERE instance_id IN (SELECT id FROM schedule_instances WHERE $RANGE)"
check_plan "attendance_sessions by student and entry" \
  "SELECT * FROM attendance_sessions WHERE student_id = (SELECT id FROM students LIMIT 1) AND entrada >= '2026-02-02'"
check_plan "schedule_students by schedule" \
  "SELECT * FROM schedule_students WHERE schedule_id IN (SELECT id FROM schedules) AND valid_to IS NULL"
check_plan "alarm_events by occurrence" \
  "SELECT * FROM alarm_events WHERE instance_id IN (SELECT id FROM schedule_instances WHERE $RANGE)"

echo "== seed:dev on its own throw-away database =="
# The name contains "seed" and "dev", so the guard of seed:dev accepts it; the
# development database is never involved.
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$SEED_DB\"" >/dev/null
seed_sql() { psql "$SEED_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }
seed_dev() { DATABASE_URL="$SEED_URL" node dist/dev-seed/run-seed-dev.js "$@"; }
TODAY_FIXED="2026-11-07"

# Refusals first: nothing may change.
set +e
NODE_ENV=production DATABASE_URL="$SEED_URL" node dist/dev-seed/run-seed-dev.js --confirm "$SEED_DB" >/dev/null 2>&1
[[ $? -eq 2 ]] || fail "seed:dev did not refuse NODE_ENV=production"
DATABASE_URL="postgresql://u:p@db.invalid:5432/$SEED_DB" node dist/dev-seed/run-seed-dev.js --confirm "$SEED_DB" >/dev/null 2>&1
[[ $? -eq 2 ]] || fail "seed:dev did not refuse a non-local host"
DATABASE_URL="postgresql://u:p@localhost:5432/gymtime_prod" node dist/dev-seed/run-seed-dev.js --confirm gymtime_prod >/dev/null 2>&1
[[ $? -eq 2 ]] || fail "seed:dev did not refuse a database that is not for development"
seed_dev --today "$TODAY_FIXED" --confirm wrong_name >/dev/null 2>&1
[[ $? -eq 2 ]] || fail "seed:dev accepted a wrong confirmation"
seed_dev --today "$TODAY_FIXED" </dev/null >/dev/null 2>&1
[[ $? -eq 2 ]] || fail "seed:dev wrote without confirmation"
seed_dev --today "$TODAY_FIXED" --dry-run >/dev/null || fail "dry-run failed"
set -e
[[ "$(seed_sql -c "select count(*) from information_schema.tables where table_schema='public'")" == "0" ]] \
  || fail "a refused or simulated run changed the database"
echo "ok   refusals and --dry-run change nothing"

seed_dev --today "$TODAY_FIXED" --confirm "$SEED_DB" >/dev/null
count() { seed_sql -c "select count(*) from $1"; }
[[ "$(count students)" == 30 && "$(count fingerprints)" == 21 && "$(count panel_users)" == 2 ]] \
  || fail "unexpected sample counts"
[[ "$(seed_sql -c "select count(*) from fingerprints where length(plantilla) = 512 + 16 and length(iv) = 12")" == 21 ]] \
  || fail "sample templates are not 512 bytes sealed with AES-GCM"
[[ "$(seed_sql -c "select count(*) from panel_users where password_hash like '\$argon2id\$%' and not must_change_password")" == 2 ]] \
  || fail "sample users do not have argon2id hashes"
MIGRATIONS="$(count _prisma_migrations)"
digest() { seed_sql -c "select md5(string_agg(id::text, ',' order by id)) from attendance_sessions"; }
FIRST="$(digest)"
echo "ok   sample set loaded: $(count attendance_sessions) sessions, $(count alarm_events) alarms, $(count offline_events) offline events"

# A foreign row must disappear (the wipe is total) and a second run must give the same set.
seed_sql -c "insert into students (documento, nombre) values ('MANUAL-1', 'Manual')" >/dev/null
seed_dev --today "$TODAY_FIXED" --confirm "$SEED_DB" >/dev/null
[[ "$(count students)" == 30 ]] || fail "second run left the foreign student"
[[ "$(digest)" == "$FIRST" ]] || fail "two runs with the same --today differ"
[[ "$(count _prisma_migrations)" == "$MIGRATIONS" ]] || fail "_prisma_migrations changed"
echo "ok   second run gives the same set and keeps _prisma_migrations"

seed_dev --today "$TODAY_FIXED" --confirm "$SEED_DB" --with-semester >/dev/null
[[ "$(seed_sql -c "select count(*) from students where documento like 'SIM-%'")" == 40 ]] || fail "--with-semester did not add the simulated semester"
echo "ok   --with-semester adds the SIM- semester"

echo "V15 passed."
