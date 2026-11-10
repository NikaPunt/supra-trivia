#!/bin/bash
# Backs up the trivia database, .env and hosts file into a dated folder, and keeps the newest 30.
#   deploy/backup.sh /path/to/trivia /path/to/backups
# Uses SQLite's own backup, so the copy is complete even while the app is running, and checks it afterwards.
# Exits non-zero on any failure, so cron or a wrapper can raise the alarm. The backup holds secrets: keep it private.
set -u
SRC="${1:?usage: backup.sh /path/to/trivia /path/to/backups}"
DEST="${2:?usage: backup.sh /path/to/trivia /path/to/backups}"
KEEP="${KEEP:-30}"
DB="${DB_FILE:-$SRC/data/trivia.db}"
OUT="$DEST/$(date +%Y-%m-%d_%H%M%S)"

fail() { echo "$(date): backup FAILED: $*" >&2; rm -rf "$OUT"; exit 1; }

[ -f "$DB" ] || fail "no database at $DB"
[ -d "$DEST" ] || fail "$DEST does not exist (is the backup drive mounted?)"
mkdir -p "$OUT" && chmod 700 "$OUT" || fail "cannot create $OUT"

python3 -I - "$DB" "$OUT/trivia.db" <<'PY' || fail "sqlite backup or integrity check"
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close(); src.close()
sys.exit(0 if ok == "ok" else 1)
PY

for f in "$SRC/.env" "$SRC/config/hosts.json"; do
  [ -f "$f" ] && { cp "$f" "$OUT/$(basename "$f" | sed 's/^\.//')" || fail "copying $f"; }
done
chmod 600 "$OUT"/*

ls -1dt "$DEST"/20* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "$(date): backup OK -> $OUT ($(du -sh "$OUT" | cut -f1))"
