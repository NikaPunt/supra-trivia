#!/usr/bin/env bash
# Backs up the database (a consistent copy even while the app is running), the hosts file and .env.
#   DEST=/path/to/backups tools/backup.sh
# Optional: SRC (the project folder, default: this repo), KEEP (how many dated copies to keep, default 30).
# Run it nightly with cron, for example:   30 3 * * *  DEST=/mnt/backup/trivia /path/to/Trivia/tools/backup.sh
set -euo pipefail

SRC="${SRC:-$(cd "$(dirname "$0")/.." && pwd)}"
DEST="${DEST:?set DEST to the folder that should hold the backups}"
KEEP="${KEEP:-30}"
DB="${DB_PATH:-$SRC/data/trivia.db}"
OUT="$DEST/$(date +%Y-%m-%d_%H%M%S)"

[ -f "$DB" ] || { echo "no database at $DB" >&2; exit 1; }
umask 077
mkdir -p "$OUT"

python3 -I - "$DB" "$OUT/trivia.db" <<'PY' || { echo "database backup failed" >&2; rm -rf "$OUT"; exit 1; }
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close(); src.close()
sys.exit(0 if ok == "ok" else 1)
PY

[ -f "$SRC/config/hosts.json" ] && cp "$SRC/config/hosts.json" "$OUT/hosts.json"
[ -f "$SRC/.env" ] && cp "$SRC/.env" "$OUT/env"

# Keep the newest $KEEP copies.
ls -1dt "$DEST"/20* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "backup written to $OUT"
