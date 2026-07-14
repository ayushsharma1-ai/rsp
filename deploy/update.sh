#!/usr/bin/env bash
# ============================================================================
#  RSP — update the running app on the VM from git.  ONE command, no file edits.
#
#  Workflow:
#    1. On your laptop:   git push        (send your changes to GitHub)
#    2. On the VM:        cd /opt/rsp && ./deploy/update.sh
#
#  It pulls the latest code, updates backend deps + restarts the API, rebuilds
#  the frontend, and publishes it to nginx's web root. Safe to run repeatedly.
#
#  First-time setup is in DEPLOY.md — this script is only for UPDATES after that.
#
#  Sudo: needs passwordless sudo for `systemctl restart rsp` and writing to
#  /var/www/rsp (or run the whole script with sudo). See DEPLOY.md §12.
# ============================================================================
set -euo pipefail

APP_DIR="/opt/rsp"            # the git checkout (this file is $APP_DIR/deploy/update.sh)
WEB_ROOT="/var/www/rsp"       # where nginx serves the built frontend
SERVICE="rsp"                 # systemd unit name
BRANCH="main"

cd "$APP_DIR"

echo "▶ [1/5] Pulling latest code from origin/$BRANCH…"
git fetch --all --quiet
# Hard reset makes the VM EXACTLY match GitHub — never hand-edit files on the VM,
# make changes on your laptop and push. (Discards any local drift on the VM.)
git reset --hard "origin/$BRANCH"

echo "▶ [2/5] Backend: syncing Python dependencies…"
backend/venv/bin/pip install -q -r backend/requirements.txt

# NOTE: the app auto-creates NEW tables on restart, but does NOT alter EXISTING
# tables. If this update adds/renames a COLUMN on an existing table, apply that
# change manually first (a one-off SQL/ALTER or an alembic migration) — otherwise
# the API will error. New tables and new rows need nothing here.

echo "▶ [3/5] Backend: restarting the API service…"
sudo systemctl restart "$SERVICE"

echo "▶ [4/5] Frontend: installing deps + building…"
( cd frontend && npm ci --no-audit --no-fund && npm run build )

echo "▶ [5/5] Frontend: publishing to $WEB_ROOT…"
sudo rsync -a --delete frontend/dist/ "$WEB_ROOT/"

echo ""
echo "✔ Done.  API: $(systemctl is-active "$SERVICE")  ·  frontend published to $WEB_ROOT"
echo "  Check it:  curl -sf https://localhost/health  &&  open the site."
