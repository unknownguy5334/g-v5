#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"

command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump is required. Install PostgreSQL client tooling first." >&2
  exit 1
}

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Backup directory is not a directory: $BACKUP_DIR" >&2
  exit 1
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp "$BACKUP_DIR/.gadwal-$STAMP.XXXXXX.tmp")"
OUT="$BACKUP_DIR/gadwal-$STAMP.dump"
trap 'rm -f -- "$TMP"' EXIT

echo "Creating PostgreSQL backup: $OUT"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$TMP"
mv -- "$TMP" "$OUT"
trap - EXIT
chmod 600 -- "$OUT"
echo "Backup complete: $OUT"
