#!/bin/bash
# Nightly snapshot of the prod Convex deployment (all tables + file storage).
# Installed as a launchd job (see scripts/install-backup-job.sh); run manually
# any time. Restore: npx convex import --prod --replace-all <zipfile>  (prompts
# for confirmation; test against dev first with plain `npx convex import`).
set -euo pipefail

BACKUP_DIR="$HOME/Commons-backups"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y-%m-%d)"
TARGET="$BACKUP_DIR/commons-prod-$STAMP.zip"

mkdir -p "$BACKUP_DIR"
cd "$REPO_DIR/packages/backend"

# GUI-launched launchd jobs get a bare PATH; make sure node/npx resolve.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

npx convex export --prod --include-file-storage --path "$TARGET"

# Keep two weeks of dailies.
find "$BACKUP_DIR" -name "commons-prod-*.zip" -mtime +14 -delete

echo "backup ok: $TARGET ($(du -h "$TARGET" | cut -f1))"
