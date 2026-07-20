#!/usr/bin/env bash
# ============================================================================
#  RSP — apply an update bundle on the VM (no internet needed).
#
#  Loop:
#    1. On your laptop:  deploy\make_update.ps1     -> builds rsp_update.tar.gz
#    2. scp it over:     scp rsp_update.tar.gz vmadmin@<VM_IP>:~/
#    3. On the VM:       bash /opt/rsp/deploy/apply_update.sh
#
#  It extracts the new backend code + built frontend, republishes the frontend to
#  nginx's web root, and restarts the API. Your .env and venv/ are NOT touched
#  (tar only overwrites files that are inside the archive).
#
#  NOTE: if backend dependencies changed (requirements.txt), this is not enough —
#  you also need a fresh wheels bundle, since the VM can't reach PyPI.
# ============================================================================
set -euo pipefail

APP=/opt/rsp
WEB=/var/www/rsp
BUNDLE="${1:-$HOME/rsp_update.tar.gz}"

[ -f "$BUNDLE" ] || { echo "No update bundle found at: $BUNDLE" >&2; exit 1; }

echo "▶ [1/4] Extracting $(basename "$BUNDLE") into $APP …"
tar -xzf "$BUNDLE" -C "$APP"

echo "▶ [2/4] Publishing frontend to $WEB …"
sudo mkdir -p "$WEB"
sudo find "$WEB" -mindepth 1 -delete          # clear old build (safer than rm -rf *)
sudo cp -a "$APP/frontend_dist/." "$WEB/"
sudo restorecon -R "$WEB" 2>/dev/null || true # SELinux: keep the web-content label

echo "▶ [3/4] Restarting the API …"
sudo systemctl restart rsp

echo "▶ [4/4] Checking …"
sleep 2
echo -n "  service: "; systemctl is-active rsp
echo -n "  api    : "; curl -sf http://127.0.0.1:8000/health || echo "NO RESPONSE (journalctl -u rsp -e)"
echo ""
curl -sf -o /dev/null -w "  nginx  : HTTP %{http_code}\n" http://127.0.0.1/ || echo "  nginx  : no response"
echo "✔ Update applied."
