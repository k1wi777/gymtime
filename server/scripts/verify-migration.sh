#!/usr/bin/env bash
# Verifies that the iteration 2 migrations upgrade an iteration 1 database
# without losing data (E14-4) and that the report indexes are used (E14-3).
#
# Creates a throw-away database, applies the migrations up to the last one of
# iteration 1, loads sample data, applies the rest and checks counts, values
# and EXPLAIN plans. Needs a PostgreSQL (docker compose up -d) and `psql`.
# Outside `rei check`: it touches a real database server.
#
#   npm run test:migration            (from the repo root or from server/)
#   DATABASE_URL=postgresql://... npm run test:migration
set -euo pipefail

ITER1_LAST="20261102170000_device_command_created_at"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../prisma/migrations"
ROOT_ENV="$HERE/../../.env"

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

# Same server and credentials, another database; drop the query string (?schema=).
BASE_URL="${DATABASE_URL%%\?*}"
SERVER_URL="${BASE_URL%/*}"
TEMP_DB="gymtime_migration_check_$$"
ADMIN_URL="$SERVER_URL/postgres"
TEMP_URL="$SERVER_URL/$TEMP_DB"

if ! psql "$ADMIN_URL" -qtAc 'select 1' >/dev/null 2>&1; then
  echo "SKIP: cannot connect to PostgreSQL (is 'docker compose up -d' running?); nothing verified." >&2
  exit 0
fi

cleanup() {
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$TEMP_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql "$ADMIN_URL" -qc "CREATE DATABASE \"$TEMP_DB\"" >/dev/null

sql() { psql "$TEMP_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
expect() { # expect <description> <expected> <query>
  local got
  got="$(sql -c "$3")"
  [[ "$got" == "$2" ]] || fail "$1: expected '$2', got '$got'"
  echo "ok   $1"
}

apply_migrations() { # apply_migrations <from-exclusive|-> <to-inclusive|->
  local name past_from=0
  [[ "$1" == "-" ]] && past_from=1
  for dir in "$MIGRATIONS"/*/; do
    name="$(basename "$dir")"
    if [[ $past_from -eq 0 ]]; then
      [[ "$name" == "$1" ]] && past_from=1
      continue
    fi
    sql -f "$dir/migration.sql" >/dev/null
    echo "applied $name"
    [[ "$2" != "-" && "$name" == "$2" ]] && return 0
  done
  return 0
}

echo "== Iteration 1 schema =="
apply_migrations - "$ITER1_LAST"

echo "== Iteration 1 sample data =="
sql <<'SQL'
INSERT INTO students (id, documento, nombre, programa, consentimiento) VALUES
  ('00000000-0000-4000-8000-000000000001', '1001', 'Ana Maria Gomez Perez', 'Ingenieria', true),
  ('00000000-0000-4000-8000-000000000002', '1002', 'Luis Mora', NULL, true),
  ('00000000-0000-4000-8000-000000000003', '1003', 'Eva Ruiz', NULL, false),
  ('00000000-0000-4000-8000-000000000004', '1004', 'Inactivo Con Evento', NULL, true),
  ('00000000-0000-4000-8000-000000000005', '1005', 'Inactivo Sin Evento', NULL, true);
UPDATE students SET activo = false WHERE documento IN ('1004', '1005');
INSERT INTO fingerprints (student_id, plantilla, iv) VALUES
  ('00000000-0000-4000-8000-000000000001', '\xdeadbeef', '\x00112233');
INSERT INTO devices (id, version_firmware) VALUES ('esp32-1', '1.0.0');
INSERT INTO schedules (id, nombre, dia_semana, inicio, fin) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Mananas', 1, '10:00', '11:00');
INSERT INTO schedules (id, nombre, fecha, inicio, fin) VALUES
  ('00000000-0000-4000-8000-0000000000a2', 'Sin ocurrencias', '2099-01-01', '10:00', '11:00');
INSERT INTO schedule_instances (id, schedule_id, fecha, inicio, fin) VALUES
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '2026-10-26', '2026-10-26 15:00+00', '2026-10-26 16:00+00'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', '2026-11-02', '2026-11-02 15:00+00', '2026-11-02 16:00+00');
INSERT INTO schedule_students (schedule_id, student_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000005');
INSERT INTO attendance_sessions (student_id, instance_id, entrada, salida, origen_entrada, origen_salida, estado) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', '2026-10-26 15:05+00', '2026-10-26 15:55+00', 'device', 'device', 'cerrada'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b2', '2026-11-02 15:02+00', NULL, 'device', NULL, 'abierta'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', '2026-11-02 15:10+00', '2026-11-02 15:50+00', 'manual', 'manual', 'cerrada');
INSERT INTO alarm_events (instance_id, inicio) VALUES
  ('00000000-0000-4000-8000-0000000000b2', '2026-11-02 16:00+00');
INSERT INTO device_commands (device_id, tipo, payload, estado) VALUES
  ('esp32-1', 'alarm.set', '{"on":true}', 'acked'),
  ('esp32-1', 'schedule.set', '{}', 'pending');
INSERT INTO processed_messages (message_id, device_id) VALUES ('m1', 'esp32-1');
INSERT INTO event_log (tipo, detalle) VALUES ('legacy.event', '{"a":1}');
INSERT INTO event_log (tipo, detalle, fecha) VALUES
  ('student.deactivated', '{"studentId":"00000000-0000-4000-8000-000000000004"}', '2026-11-03 20:00+00'),
  ('student.deactivated', '{"studentId":"00000000-0000-4000-8000-000000000004"}', '2026-11-09 20:00+00');
SQL

TABLES=(students fingerprints devices schedules schedule_students schedule_instances
  attendance_sessions alarm_events device_commands processed_messages event_log)
declare -A BEFORE
for table in "${TABLES[@]}"; do BEFORE[$table]="$(sql -c "SELECT count(*) FROM $table")"; done

echo "== Iteration 2 migrations =="
apply_migrations "$ITER1_LAST" -

echo "== No row lost =="
for table in "${TABLES[@]}"; do
  expect "$table keeps its ${BEFORE[$table]} row(s)" "${BEFORE[$table]}" "SELECT count(*) FROM $table"
done

echo "== Expected values =="
expect "students: display_name, correo and telefono start NULL" "5" \
  "SELECT count(*) FROM students WHERE display_name IS NULL AND correo IS NULL AND telefono IS NULL"
expect "students keep their names and degree" "Ana Maria Gomez Perez|Ingenieria" \
  "SELECT nombre || '|' || programa FROM students WHERE documento = '1001'"
expect "assignments of active students stay active" "3" \
  "SELECT count(*) FROM schedule_students ss JOIN students s ON s.id = ss.student_id WHERE s.activo AND ss.valid_to IS NULL"
expect "valid_from is the first occurrence (Bogota midnight)" "2026-10-26 05:00:00+00" \
  "SELECT valid_from AT TIME ZONE 'UTC' || '+00' FROM schedule_students WHERE schedule_id = '00000000-0000-4000-8000-0000000000a1' AND student_id = '00000000-0000-4000-8000-000000000001'"
expect "valid_from without occurrences is not in the future" "0" \
  "SELECT count(*) FROM schedule_students WHERE valid_from > now()"
expect "the past sessions are covered by their assignment" "3" \
  "SELECT count(*) FROM attendance_sessions a JOIN schedule_instances i ON i.id = a.instance_id JOIN schedule_students ss ON ss.schedule_id = i.schedule_id AND ss.student_id = a.student_id WHERE ss.valid_from <= a.entrada AND ss.valid_to IS NULL"
expect "every assignment got an id" "5" "SELECT count(DISTINCT id) FROM schedule_students"
expect "old event_log rows are attributed to system" "system|" \
  "SELECT actor_type || '|' || coalesce(actor_id, '') FROM event_log WHERE tipo = 'legacy.event'"

expect "panel accounts and sessions start empty (H7)" "0|0" \
  "SELECT (SELECT count(*) FROM panel_users) || '|' || (SELECT count(*) FROM auth_sessions)"
sql -c "INSERT INTO panel_users (id, name, username, password_hash, role) VALUES ('00000000-0000-4000-8000-0000000000c1', 'T', 'tester', 'x', 'admin')" >/dev/null
sql -c "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ('00000000-0000-4000-8000-0000000000c1', 'h', now())" >/dev/null
sql -c "DELETE FROM panel_users WHERE username = 'tester'" >/dev/null
expect "deleting an account deletes its sessions (H7)" "0" "SELECT count(*) FROM auth_sessions"

echo "== H9: periods, consent and import batches =="
expect "legacy recurring schedule keeps a NULL period and its occurrences" "NULL|2" \
  "SELECT coalesce(period_id::text, 'NULL') || '|' || (SELECT count(*) FROM schedule_instances WHERE schedule_id = s.id) FROM schedules s WHERE id = '00000000-0000-4000-8000-0000000000a1'"
expect "existing students with consent get the current text version" "v1-provisional|v1-provisional|NULL" \
  "SELECT (SELECT coalesce(consent_version, 'NULL') FROM students WHERE documento = '1001') || '|' || (SELECT coalesce(consent_version, 'NULL') FROM students WHERE documento = '1002') || '|' || (SELECT coalesce(consent_version, 'NULL') FROM students WHERE documento = '1003')"
expect "their consent date is the registration date and nobody authored it" "4|0" \
  "SELECT count(*) FILTER (WHERE consent_at = created_at) || '|' || count(*) FILTER (WHERE consent_by IS NOT NULL) FROM students WHERE consent_version IS NOT NULL"
expect "no student carries the old 'legacy' label" "0" \
  "SELECT count(*) FROM students WHERE consent_version = 'legacy'"
expect "the student without consent has no date either" "1" \
  "SELECT count(*) FROM students WHERE documento = '1003' AND consent_at IS NULL AND consent_by IS NULL"
expect "the boolean column is gone" "0" \
  "SELECT count(*) FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'consentimiento'"
expect "periods, exceptions and import batches start empty" "0|0|0" \
  "SELECT (SELECT count(*) FROM periods) || '|' || (SELECT count(*) FROM service_exceptions) || '|' || (SELECT count(*) FROM import_batches)"
expect "existing students belong to no import batch" "0" \
  "SELECT count(*) FROM students WHERE import_batch_id IS NOT NULL"
sql -c "INSERT INTO periods (id, nombre, inicio, fin, activo) VALUES ('00000000-0000-4000-8000-0000000000d1', '2026-2', '2026-08-01', '2026-12-01', true)" >/dev/null
if sql -c "INSERT INTO periods (nombre, inicio, fin, activo) VALUES ('Otro', '2027-01-01', '2027-05-01', true)" >/dev/null 2>&1; then
  fail "a second active period was accepted"
fi
echo "ok   at most one active period"
if sql -c "INSERT INTO periods (nombre, inicio, fin) VALUES ('Mal', '2027-05-01', '2027-01-01')" >/dev/null 2>&1; then
  fail "a period ending before it starts was accepted"
fi
echo "ok   a period cannot end before it starts"
if sql -c "INSERT INTO service_exceptions (period_id, desde, hasta, motivo) VALUES ('00000000-0000-4000-8000-0000000000d1', '2026-10-05', '2026-10-01', 'x')" >/dev/null 2>&1; then
  fail "an exception ending before it starts was accepted"
fi
echo "ok   an exception cannot end before it starts"
sql -c "UPDATE schedules SET period_id = '00000000-0000-4000-8000-0000000000d1' WHERE id = '00000000-0000-4000-8000-0000000000a1'" >/dev/null
if sql -c "DELETE FROM periods WHERE id = '00000000-0000-4000-8000-0000000000d1'" >/dev/null 2>&1; then
  fail "a period with schedules was deleted"
fi
echo "ok   a period with schedules is not deleted"
sql -c "UPDATE schedules SET period_id = NULL WHERE id = '00000000-0000-4000-8000-0000000000a1'" >/dev/null
sql -c "INSERT INTO service_exceptions (period_id, desde, hasta, motivo) VALUES ('00000000-0000-4000-8000-0000000000d1', '2026-10-12', '2026-10-12', 'Festivo')" >/dev/null
sql -c "DELETE FROM periods WHERE id = '00000000-0000-4000-8000-0000000000d1'" >/dev/null
expect "deleting a period deletes its exceptions" "0" "SELECT count(*) FROM service_exceptions"

echo "== H11: validity backfill for deactivated students =="
expect "inactive student with event: interval closed at the FIRST event" "2026-11-03 20:00:00+00" \
  "SELECT valid_to AT TIME ZONE 'UTC' || '+00' FROM schedule_students WHERE student_id = '00000000-0000-4000-8000-000000000004'"
expect "inactive student without event: interval left open (listed in the NOTICE)" "1" \
  "SELECT count(*) FROM schedule_students WHERE student_id = '00000000-0000-4000-8000-000000000005' AND valid_to IS NULL"
expect "intervals of active students were not touched" "3" \
  "SELECT count(*) FROM schedule_students ss JOIN students s ON s.id = ss.student_id WHERE s.activo AND ss.valid_to IS NULL"
sql -f "$MIGRATIONS/20261106200000_h11_schedule_validity_backfill/migration.sql" >/dev/null 2>&1 || fail "the backfill failed when run a second time"
expect "running the backfill twice changes nothing" "2026-11-03 20:00:00+00" \
  "SELECT valid_to AT TIME ZONE 'UTC' || '+00' FROM schedule_students WHERE student_id = '00000000-0000-4000-8000-000000000004'"

echo "== H11: tokens, key versions, erasure and alerts =="
expect "existing templates are key version 1" "1|1" \
  "SELECT count(*) || '|' || count(*) FILTER (WHERE key_version = 1) FROM fingerprints"
expect "devices start without own token, revocation or alert" "1" \
  "SELECT count(*) FROM devices WHERE token_hash IS NULL AND token_created_at IS NULL AND token_revoked_at IS NULL AND offline_since IS NULL AND offline_alerted_at IS NULL"
expect "no student starts anonymised" "0" "SELECT count(*) FROM students WHERE anonymized_at IS NOT NULL"

echo "== H12: offline mode =="
expect "existing alarms keep their values and are server alarms" "1|1|0" \
  "SELECT count(*) || '|' || count(*) FILTER (WHERE origin = 'server') || '|' || count(*) FILTER (WHERE device_id IS NOT NULL OR device_event_id IS NOT NULL) FROM alarm_events"
expect "existing sessions keep their sources" "3|2|1" \
  "SELECT count(*) || '|' || count(*) FILTER (WHERE origen_entrada = 'device') || '|' || count(*) FILTER (WHERE origen_entrada = 'manual') FROM attendance_sessions"
expect "the existing device is a v0 reader without clock check" "{}|NULL|NULL" \
  "SELECT capabilities::text || '|' || coalesce(clock_offset_sec::text, 'NULL') || '|' || coalesce(clock_checked_at::text, 'NULL') FROM devices WHERE id = 'esp32-1'"
expect "offline tables start empty" "0|0" \
  "SELECT (SELECT count(*) FROM offline_snapshots) || '|' || (SELECT count(*) FROM offline_events)"
expect "the new attendance source is usable" "offline" \
  "INSERT INTO attendance_sessions (student_id, instance_id, entrada, origen_entrada, estado) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1', '2026-10-26 15:20+00', 'offline', 'abierta') RETURNING origen_entrada"
sql -c "DELETE FROM attendance_sessions WHERE origen_entrada = 'offline'" >/dev/null
sql -c "UPDATE devices SET capabilities = ARRAY['offline'] WHERE id = 'esp32-1'" >/dev/null
sql -c "INSERT INTO offline_events (device_id, id, seq, ts, type, outcome) VALUES ('esp32-1', '00000000-0000-4000-8000-0000000000f1', 1, now(), 'entry', 'pendiente')" >/dev/null
if sql -c "INSERT INTO offline_events (device_id, id, seq, ts, type, outcome) VALUES ('esp32-1', '00000000-0000-4000-8000-0000000000f1', 2, now(), 'entry', 'pendiente')" >/dev/null 2>&1; then
  fail "an offline event with the same (device, id) was accepted"
fi
echo "ok   an offline event is unique per (device, id)"
if sql -c "INSERT INTO offline_events (device_id, id, seq, ts, type, outcome) VALUES ('esp32-1', '00000000-0000-4000-8000-0000000000f2', 1, now(), 'entry', 'inventado')" >/dev/null 2>&1; then
  fail "an unknown offline outcome was accepted"
fi
echo "ok   offline outcomes are a closed set (CHECK)"
sql -c "INSERT INTO alarm_events (instance_id, inicio, fin, cerrada_por, origin, device_id, device_event_id) VALUES ('00000000-0000-4000-8000-0000000000b1', now(), now(), 'button', 'local', 'esp32-1', '00000000-0000-4000-8000-0000000000f3')" >/dev/null
if sql -c "INSERT INTO alarm_events (instance_id, inicio, origin, device_id, device_event_id) VALUES ('00000000-0000-4000-8000-0000000000b1', now(), 'local', 'esp32-1', '00000000-0000-4000-8000-0000000000f3')" >/dev/null 2>&1; then
  fail "a local alarm of the same reader event was stored twice"
fi
echo "ok   a local alarm is unique per reader event"
sql -c "DELETE FROM alarm_events WHERE origin = 'local'; DELETE FROM offline_events" >/dev/null
sql -c "UPDATE devices SET capabilities = '{}' WHERE id = 'esp32-1'" >/dev/null

echo "== Constraints =="
if sql -c "INSERT INTO schedule_students (schedule_id, student_id, valid_from) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', now())" >/dev/null 2>&1; then
  fail "a second active assignment of the same pair was accepted"
fi
echo "ok   one active assignment per pair"
sql -c "UPDATE schedule_students SET valid_to = now() WHERE schedule_id = '00000000-0000-4000-8000-0000000000a1' AND student_id = '00000000-0000-4000-8000-000000000001'" >/dev/null
sql -c "INSERT INTO schedule_students (schedule_id, student_id, valid_from) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', now())" >/dev/null
expect "closing and reassigning keeps both intervals" "2" \
  "SELECT count(*) FROM schedule_students WHERE schedule_id = '00000000-0000-4000-8000-0000000000a1' AND student_id = '00000000-0000-4000-8000-000000000001'"

echo "== Report indexes (EXPLAIN) =="
sql <<'SQL' >/dev/null
INSERT INTO students (documento, nombre)
  SELECT 'bulk' || n, 'Bulk ' || n FROM generate_series(1, 60) n;
INSERT INTO schedule_instances (schedule_id, fecha, inicio, fin)
  SELECT '00000000-0000-4000-8000-0000000000a1', d::date, d + interval '15 hours', d + interval '16 hours'
  FROM generate_series('2025-01-01'::date, '2026-06-30'::date, '1 day') d;
INSERT INTO attendance_sessions (student_id, instance_id, entrada, salida, origen_entrada, origen_salida, estado)
  SELECT s.id, i.id, i.inicio + interval '5 minutes', i.inicio + interval '55 minutes', 'device', 'device', 'cerrada'
  FROM (SELECT id FROM students WHERE documento LIKE 'bulk%') s
  CROSS JOIN (SELECT id, inicio FROM schedule_instances WHERE fecha < '2026-06-30' ORDER BY fecha LIMIT 300) i;
ANALYZE;
SQL

# The planner may prefer a sequential scan on small tables; forbidding it makes
# the check deterministic: it proves an index CAN serve the query.
plan_uses() { # plan_uses <description> <index-regex> <query>
  local plan
  plan="$(sql -c "SET enable_seqscan = off; EXPLAIN $3" | tr '\n' ' ')"
  if [[ "$plan" =~ $2 ]]; then echo "ok   $1 -> ${BASH_REMATCH[0]}"; else fail "$1: no index matching $2 in plan: $plan"; fi
}
S='00000000-0000-4000-8000-000000000001'
plan_uses "sessions by entry date" "attendance_sessions_entrada_idx" \
  "SELECT * FROM attendance_sessions WHERE entrada >= '2026-01-01' AND entrada < '2026-01-08'"
plan_uses "sessions of a student by date" "attendance_sessions_student_id_entrada_idx" \
  "SELECT * FROM attendance_sessions WHERE student_id = '$S' AND entrada >= '2025-06-01' AND entrada < '2026-07-01'"
plan_uses "sessions of an occurrence" "attendance_sessions_instance_id_estado_idx" \
  "SELECT * FROM attendance_sessions WHERE instance_id = '00000000-0000-4000-8000-0000000000b2' AND estado = 'cerrada'"
plan_uses "occurrences by date" "schedule_instances_fecha_idx" \
  "SELECT * FROM schedule_instances WHERE fecha >= '2026-01-01' AND fecha < '2026-02-01'"
plan_uses "occurrences of a schedule by date" "schedule_instances_(schedule_id_fecha_key|fecha_idx)" \
  "SELECT * FROM schedule_instances WHERE schedule_id = '00000000-0000-4000-8000-0000000000a1' AND fecha >= '2026-01-01' AND fecha < '2026-02-01'"
plan_uses "assignments of a student over time" "schedule_students_student_id_valid_from_idx" \
  "SELECT * FROM schedule_students WHERE student_id = '$S' AND valid_from <= now()"
plan_uses "active assignments of a schedule" "schedule_students_(one_active|schedule_id_valid_to_idx)" \
  "SELECT * FROM schedule_students WHERE schedule_id = '00000000-0000-4000-8000-0000000000a1' AND valid_to IS NULL"

echo "== Schema drift (schema.prisma vs migrations) =="
SERVER_DIR="$(cd "$HERE/.." && pwd)"
if (cd "$SERVER_DIR" && DATABASE_URL="$TEMP_URL" npx --no-install prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code >/dev/null 2>&1); then
  echo "ok   migrations and schema.prisma agree"
else
  fail "schema.prisma differs from what the migrations produce (run prisma migrate diff)"
fi

echo "Migration check passed."
