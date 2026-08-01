#!/usr/bin/env bash
# ============================================================================
#  RSP — apply an update bundle on the VM (no internet needed).
#
#  Loop:
#    1. On your laptop:  deploy\make_update.ps1     -> builds rsp_update.tar.gz
#    2. scp it over:     scp rsp_update.tar.gz vmadmin@<VM_IP>:~/
#    3. On the VM:       bash /opt/rsp/deploy/apply_update.sh
#
#  It snapshots what's live, extracts the new backend code + built frontend,
#  republishes the frontend to nginx's web root, and restarts the API. Your .env
#  and venv/ are NOT touched (tar only overwrites files inside the archive).
#
#  If the new build is bad, roll straight back:
#      bash /opt/rsp/deploy/apply_update.sh --rollback
#
#  NOTE: if backend dependencies changed (requirements.txt), this is not enough —
#  you also need a fresh wheels bundle, since the VM can't reach PyPI.
# ============================================================================
set -euo pipefail

APP=/opt/rsp
WEB=/var/www/rsp
SNAP=/opt/rsp_previous              # one-deep snapshot: the version we replaced

# ── Run from a COPY of ourselves ────────────────────────────────────────────
# The bundle ships deploy/, so the tar below overwrites THIS FILE while bash is
# still reading it. Bash reads a script lazily by byte offset, so replacing it
# mid-run can make it resume at the wrong place and execute garbage. Re-exec
# from a temp copy first, then the extraction can't touch what's running.
if [ "${RSP_RELOCATED:-}" != "1" ]; then
    _self="$(mktemp /tmp/rsp_apply.XXXXXX.sh)"
    cp "$0" "$_self"
    chmod +x "$_self"
    RSP_RELOCATED=1 exec bash "$_self" "$@"
fi
trap 'rm -f "$0"' EXIT              # tidy the temp copy on the way out

# ── Rollback ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
    [ -d "$SNAP" ] || { echo "No snapshot at $SNAP — nothing to roll back to." >&2; exit 1; }
    echo "▶ Restoring the previous version from $SNAP …"
    sudo cp -a "$SNAP/backend/." "$APP/backend/"
    sudo mkdir -p "$WEB"
    sudo find "$WEB" -mindepth 1 -delete
    sudo cp -a "$SNAP/frontend_dist/." "$WEB/"
    sudo cp -a "$SNAP/frontend_dist/." "$APP/frontend_dist/"
    sudo restorecon -R "$WEB" 2>/dev/null || true
    sudo systemctl restart rsp
    sleep 2
    echo -n "  service: "; systemctl is-active rsp
    echo -n "  api    : "; curl -sf http://127.0.0.1:8000/health || echo "NO RESPONSE"
    echo ""
    echo "✔ Rolled back."
    exit 0
fi

BUNDLE="${1:-$HOME/rsp_update.tar.gz}"
[ -f "$BUNDLE" ] || { echo "No update bundle found at: $BUNDLE" >&2; exit 1; }

echo "▶ [1/5] Snapshotting the running version to $SNAP …"
sudo rm -rf "$SNAP"
sudo mkdir -p "$SNAP"
sudo cp -a "$APP/backend" "$SNAP/backend"
# prefer the live web root — it is what users are actually being served
if [ -d "$WEB" ]; then
    sudo mkdir -p "$SNAP/frontend_dist"
    sudo cp -a "$WEB/." "$SNAP/frontend_dist/"
elif [ -d "$APP/frontend_dist" ]; then
    sudo cp -a "$APP/frontend_dist" "$SNAP/frontend_dist"
fi
echo "    snapshot kept (roll back with: bash $APP/deploy/apply_update.sh --rollback)"

echo "▶ [2/5] Extracting $(basename "$BUNDLE") into $APP …"
tar -xzf "$BUNDLE" -C "$APP"

echo "▶ [3/5] Publishing frontend to $WEB …"
sudo mkdir -p "$WEB"
sudo find "$WEB" -mindepth 1 -delete          # clear old build (safer than rm -rf *)
sudo cp -a "$APP/frontend_dist/." "$WEB/"
sudo restorecon -R "$WEB" 2>/dev/null || true # SELinux: keep the web-content label

echo "▶ [4/5] Restarting the API …"
sudo systemctl restart rsp

echo "▶ [5/5] Checking …"
sleep 2
ok=1
echo -n "  service: "; systemctl is-active rsp || ok=0
echo -n "  api    : "
if curl -sf http://127.0.0.1:8000/health; then echo ""; else
    echo "NO RESPONSE (journalctl -u rsp -e)"; ok=0
fi
curl -sf -o /dev/null -w "  nginx  : HTTP %{http_code}\n" http://127.0.0.1/ || { echo "  nginx  : no response"; ok=0; }

if [ "$ok" = "1" ]; then
    echo "✔ Update applied."
else
    echo ""
    echo "✖ The new version did NOT come up cleanly."
    echo "  Roll back with:  bash $APP/deploy/apply_update.sh --rollback"
    exit 1
fi
