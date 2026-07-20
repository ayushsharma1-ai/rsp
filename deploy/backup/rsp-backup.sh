#!/usr/bin/env bash
# ============================================================================
#  RSP — nightly database backup.
#
#  Runs as the `postgres` OS user (see rsp-backup.service), so it authenticates
#  over the local socket by peer auth — no DB password is stored anywhere.
#
#  Install + schedule: see deploy/backup/README-backup.md
# ============================================================================
set -euo pipefail

DB=rsp_db
DEST=/var/backups/rsp
KEEP_DAYS=14

STAMP="$(date +%F_%H%M)"
OUT="$DEST/${DB}_${STAMP}.dump"

mkdir -p "$DEST"

# -Fc = PostgreSQL's compressed "custom" format. Restored with pg_restore, and
# it allows restoring selected tables rather than all-or-nothing.
# Write to .tmp first, then move: an interrupted dump must never be mistaken
# for a good backup.
pg_dump -Fc "$DB" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
chmod 640 "$OUT"          # group can read, so the admin user can scp a copy off

# Prune anything older than the retention window.
find "$DEST" -maxdepth 1 -name "${DB}_*.dump" -type f -mtime +"$KEEP_DAYS" -delete

COUNT=$(find "$DEST" -maxdepth 1 -name "${DB}_*.dump" -type f | wc -l)
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1)) — $COUNT kept, retention ${KEEP_DAYS}d"
