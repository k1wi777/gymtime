#!/usr/bin/env bash
# Restores a backup made by deploy/backup.sh into an EMPTY database.
#
#   deploy/restore.sh <file.dump> <target-database-url> [--force]
#
# Safeguards:
#   - refuses a target that already has tables (--force restores over it,
#     dropping what the dump contains);
#   - refuses the database in DATABASE_URL / the repo .env (the live one)
#     unless --force;
#   - runs `prisma migrate deploy` afterwards so the schema is up to date
#     (skip with RESTORE_SKIP_MIGRATE=1).
# After restoring: re-apply the erasures recorded since the backup
# (docs/runbook.md, "Supresión tras restaurar") and check the encryption key
# (npm run keys:rotate -w server -- --verify).
# Never prints connection strings.
set -euo pipefail

FORCE=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done
if [[ ${#ARGS[@]} -ne 2 ]]; then
  echo "usage: deploy/restore.sh <file.dump> <target-database-url> [--force]" >&2
  exit 2
fi
FILE="${ARGS[0]}"
TARGET="${ARGS[1]%%\?*}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/.."

[[ -f "$FILE" ]] || { echo "ERROR: $FILE does not exist" >&2; exit 2; }
for tool in psql pg_restore; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool is not installed" >&2; exit 2; }
done
pg_restore --list "$FILE" >/dev/null 2>&1 || { echo "ERROR: $FILE is not a readable pg_dump archive" >&2; exit 1; }

# Compare without credentials, query string or case: host:port/database.
normalize() { sed -E 's#^[a-z]+://([^@/]*@)?##; s#\?.*$##' <<<"${1,,}"; }
LIVE=()
[[ -n "${DATABASE_URL:-}" ]] && LIVE+=("$DATABASE_URL")
if [[ -f "$ROOT/.env" ]]; then
  ENV_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -n1 | cut -d= -f2- | tr -d '"' || true)"
  [[ -n "$ENV_URL" ]] && LIVE+=("$ENV_URL")
fi
if [[ $FORCE -eq 0 ]]; then
  for url in "${LIVE[@]}"; do
    if [[ "$(normalize "$url")" == "$(normalize "$TARGET")" ]]; then
      echo "ERROR: the target is the live database (DATABASE_URL); restore into another one or pass --force" >&2
      exit 1
    fi
  done
fi

psql "$TARGET" -qtAc 'select 1' >/dev/null 2>&1 || { echo "ERROR: cannot connect to the target database" >&2; exit 1; }
TABLES="$(psql "$TARGET" -qtAc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [[ "$TABLES" -gt 0 && $FORCE -eq 0 ]]; then
  echo "ERROR: the target already has $TABLES table(s); use an empty database or --force" >&2
  exit 1
fi

OPTS=(--no-owner --no-privileges --exit-on-error --dbname="$TARGET")
[[ $FORCE -eq 1 ]] && OPTS+=(--clean --if-exists)
pg_restore "${OPTS[@]}" "$FILE"
echo "restored: $(basename "$FILE")"

if [[ "${RESTORE_SKIP_MIGRATE:-0}" != "1" ]]; then
  (cd "$ROOT/server" && DATABASE_URL="$TARGET" npx --no-install prisma migrate deploy >/dev/null)
  echo "schema: migrations up to date"
fi
echo "next: re-apply erasures since the backup and verify the key (docs/runbook.md)."
