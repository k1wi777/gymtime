#!/usr/bin/env bash
# Backup of the GymTime database in a restorable format (pg_dump custom).
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/gymtime deploy/backup.sh
#
#   BACKUP_DIR        where the copies go (default ./backups); created with mode 700
#   BACKUP_KEEP_DAYS  copies older than this are deleted (default 30; 0 = keep all).
#                     The university must confirm the retention (docs/runbook.md).
#
# What it does NOT do: it never reads or copies ENCRYPTION_KEY. The templates
# in the dump are encrypted; without the key (and the retired ones) they are
# unrecoverable. Back the key up SEPARATELY (docs/runbook.md, "Respaldo").
# Never prints the connection string (it holds the password).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

for tool in pg_dump pg_restore; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool is not installed" >&2; exit 2; }
done
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo "ERROR: BACKUP_KEEP_DAYS must be a whole number" >&2; exit 2; }

# libpq does not understand Prisma's ?schema=... query string.
URL="${DATABASE_URL%%\?*}"

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/gymtime-$STAMP.dump"
PARTIAL="$FILE.partial"
trap 'rm -f "$PARTIAL"' EXIT

# --no-owner/--no-privileges: restorable by another role (managed PostgreSQL).
pg_dump --format=custom --no-owner --no-privileges --file="$PARTIAL" "$URL"

# A dump that cannot be listed or has no tables is not a backup.
TABLES="$(pg_restore --list "$PARTIAL" | grep -c ' TABLE ' || true)"
if [[ ! -s "$PARTIAL" || "$TABLES" -lt 1 ]]; then
  echo "ERROR: the dump is empty or unreadable; nothing was kept" >&2
  exit 1
fi
mv "$PARTIAL" "$FILE"
trap - EXIT

if [[ "$KEEP_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -name 'gymtime-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete |
    sed 's/^/expired: /'
fi

SIZE="$(wc -c <"$FILE" | tr -d ' ')"
echo "backup: $FILE ($SIZE bytes, $TABLES tables)"
echo "reminder: the encryption key is NOT in this file; keep it apart (docs/runbook.md)."
