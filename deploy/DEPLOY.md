# RSP — Deployment Runbook

Step-by-step to put RSP on the institute VM behind HTTPS. Copy-paste friendly.
Companion concept guides: `../learning/DEPLOYMENT_AND_SECURITY.md` (overview) and
`../learning/HTTPS_CERTIFICATES_FIREWALL.html` (how HTTPS/certs/firewall actually work).

Assumed layout on the VM (change paths to taste, but stay consistent):

```
/opt/rsp/backend      ← this repo's rsp/backend
/opt/rsp/backend/venv ← Python virtualenv
/opt/rsp/backend/.env ← production secrets (NOT in git)
/var/www/rsp          ← built frontend (contents of rsp/frontend/dist)
/var/www/certbot      ← Let's Encrypt ACME challenge dir
```

Placeholders to replace everywhere: `scheduler.iitk.ac.in` (your domain),
`<STRONG_DB_PASSWORD>`, `<STRONG_SECRET_KEY>`.

---

## 0. Before you start
- [ ] VM provisioned, you can `ssh` in.
- [ ] DNS: an **A record** for `scheduler.iitk.ac.in` → the VM's public IP. Verify: `dig +short scheduler.iitk.ac.in` returns the VM IP.
- [ ] Firewall: inbound **80** and **443** open to the internet; **22 (SSH)** open to campus/VPN only. (See §7.)
- [ ] You are NOT root day-to-day — use a sudo user.

---

## 1. Install system packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.11 python3.11-venv python3-pip \
    postgresql nginx git ufw
# certbot for TLS certificates:
sudo apt install -y certbot python3-certbot-nginx
# Node 20 — used to BUILD the frontend on the VM (build-time only; no Node server runs):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```
> Why Node on the VM? The repo doesn't commit the built `dist/` folder (it's in
> `.gitignore`), so the VM builds the frontend itself after each `git pull`. The
> build is a one-off ~30s step; nginx serves the static output — no Node stays running.

## 2. Create the app user and folders
```bash
sudo adduser --system --group rsp
sudo mkdir -p /opt/rsp /var/www/rsp /var/www/certbot
sudo chown -R rsp:rsp /opt/rsp
```

## 3. Get the code onto the VM
```bash
# from your machine (or git clone on the VM if it has repo access)
sudo -u rsp git clone <YOUR_REPO_URL> /opt/rsp     # so backend is /opt/rsp/backend
# ...or rsync the rsp/ folder up. Either way backend lands at /opt/rsp/backend.
```

## 4. Database (PostgreSQL)
```bash
sudo -u postgres psql <<'SQL'
CREATE USER rsp WITH PASSWORD '<STRONG_DB_PASSWORD>';
CREATE DATABASE rsp_db OWNER rsp;
SQL
```
PostgreSQL listens on `localhost:5432` by default — leave it that way (never expose 5432 to the internet).

## 5. Backend: virtualenv + install
```bash
cd /opt/rsp/backend
sudo -u rsp python3.11 -m venv venv
sudo -u rsp ./venv/bin/pip install --upgrade pip
sudo -u rsp ./venv/bin/pip install -r requirements.txt
sudo -u rsp ./venv/bin/pip install "bcrypt==4.0.1"    # passlib compatibility pin
```

## 6. Production secrets — `/opt/rsp/backend/.env`
Generate a strong secret key:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```
Create the file (owned by `rsp`, mode 600 so only it can read):
```bash
sudo -u rsp tee /opt/rsp/backend/.env >/dev/null <<'ENV'
ENV=production
DATABASE_URL=postgresql://rsp:<STRONG_DB_PASSWORD>@localhost:5432/rsp_db
SECRET_KEY=<STRONG_SECRET_KEY>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
ALLOWED_EMAIL_DOMAIN=iitk.ac.in
CORS_ORIGINS=https://scheduler.iitk.ac.in
# Email (optional — leave blank to disable):
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
ENV
sudo chmod 600 /opt/rsp/backend/.env
```
> The app **refuses to boot in production** if `SECRET_KEY` is default/<32 chars,
> the DB still uses `postgres:password`, or `CORS_ORIGINS` is `*`
> (see `app/core/config.py`). That's a feature — it's stopping an insecure launch.

Create the tables (the app also does this on startup, but doing it once is explicit):
```bash
cd /opt/rsp/backend
sudo -u rsp ./venv/bin/python -c "from app.core.database import Base, engine; from app.modules import models; Base.metadata.create_all(bind=engine)"
```

Seed the event kinds (Class/Workshop/Talk colours):
```bash
sudo -u rsp ./venv/bin/python create_event_kinds.py
```

## 7. Remove weak/demo accounts (IMPORTANT)
The repo ships demo logins (admin@rsp.edu / admin123, etc.). Kill them and create
your real admin. `secure_accounts.py` is dry-run by default — inspect, then apply:
```bash
cd /opt/rsp/backend
export ADMIN_EMAIL="youradmin@iitk.ac.in"
export ADMIN_PASSWORD="<a strong admin password>"
sudo -u rsp -E ./venv/bin/python secure_accounts.py            # dry run — shows what it'll do
sudo -u rsp -E ./venv/bin/python secure_accounts.py --apply    # actually do it
```

## 8. Run the backend as a service (systemd)
```bash
sudo cp /opt/rsp/deploy/rsp.service /etc/systemd/system/rsp.service
sudo systemctl daemon-reload
sudo systemctl enable --now rsp
sudo systemctl status rsp          # should be "active (running)"
curl -s localhost:8000/health      # {"status":"ok"}
journalctl -u rsp -f               # live logs if something's wrong
```

## 9. Build & place the frontend
Build on your machine (or on the VM if Node is installed), then copy `dist/` up:
```bash
cd rsp/frontend
# point the app at the production API (same origin, so a relative path works):
echo 'VITE_API_URL=/api/v1' > .env.production
npm ci
npm run build            # → rsp/frontend/dist
# copy the CONTENTS of dist/ into /var/www/rsp on the VM, e.g.:
rsync -av --delete dist/ user@vm:/tmp/rsp-dist/ && \
  ssh user@vm 'sudo rsync -av --delete /tmp/rsp-dist/ /var/www/rsp/ && sudo chown -R www-data:www-data /var/www/rsp'
```
> Check `rsp/frontend/src/lib/api.js` uses `import.meta.env.VITE_API_URL`. With
> `VITE_API_URL=/api/v1` the browser calls `https://scheduler.iitk.ac.in/api/v1/...`
> which nginx proxies to uvicorn — no CORS needed for same-origin.

## 10. nginx + HTTPS certificate
```bash
sudo cp /opt/rsp/deploy/nginx.conf /etc/nginx/sites-available/rsp
sudo ln -s /etc/nginx/sites-available/rsp /etc/nginx/sites-enabled/rsp
sudo rm -f /etc/nginx/sites-enabled/default      # drop the placeholder site
sudo nginx -t                                    # test config syntax
```
Get the certificate (certbot edits nothing if you use `certonly`; our nginx.conf
already references the cert paths). Easiest path — let certbot handle it:
```bash
sudo certbot --nginx -d scheduler.iitk.ac.in
sudo nginx -t && sudo systemctl reload nginx
```
Certbot auto-renews via a systemd timer. Verify renewal works:
```bash
sudo certbot renew --dry-run
```
Open the site: `https://scheduler.iitk.ac.in` → padlock, calendar loads, login works.

## 11. Firewall (ufw)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# SSH: restrict to campus/VPN range if you can, instead of the whole internet:
sudo ufw allow from <CAMPUS_CIDR> to any port 22 proto tcp     # e.g. 172.16.0.0/12
sudo ufw enable
sudo ufw status verbose
```
Confirm 5432 (Postgres) and 8000 (uvicorn) are NOT in the allow list — they stay localhost-only.

---

## 12. Pre-VAPT hardening checklist
- [x] API docs disabled in production (`/docs`, `/redoc`, `/openapi.json` off — done in `app/main.py`).
- [x] Security headers + `server_tokens off` (in `nginx.conf`).
- [x] TLS 1.2/1.3 only, HSTS (in `nginx.conf`; enable HSTS only after HTTPS confirmed).
- [x] Demo/weak accounts removed (`secure_accounts.py --apply`).
- [x] Postgres + uvicorn bound to localhost; only 80/443 public.
- [ ] Dependency scan — run and update anything flagged:
  ```bash
  # Python
  cd /opt/rsp/backend && ./venv/bin/pip install pip-audit && ./venv/bin/pip-audit
  # Node (dev machine, in rsp/frontend)
  npm audit
  ```
- [ ] DB backups — schedule a nightly dump:
  ```bash
  # as a cron job:  0 2 * * *  (2am daily)
  pg_dump -U rsp rsp_db | gzip > /var/backups/rsp_$(date +\%F).sql.gz
  ```
- [ ] Confirm `.env` and `.git` are unreachable over HTTP:
  ```bash
  curl -sI https://scheduler.iitk.ac.in/.env   # expect 404
  curl -sI https://scheduler.iitk.ac.in/.git/config   # expect 404
  ```

## 13. Updating the app later — the git workflow (no file editing on the VM)

This is the whole point: **you never edit files on the VM.** You change code on your
laptop, push to GitHub, then run one script on the VM that pulls + rebuilds + restarts.

**On your laptop:**
```bash
git add -A && git commit -m "what changed" && git push
```

**On the VM (SSH in):**
```bash
cd /opt/rsp && ./deploy/update.sh
```
That script (`deploy/update.sh`) does everything: `git reset --hard origin/main`,
reinstall backend deps, restart the API, `npm ci && npm run build`, and publish the
new frontend to `/var/www/rsp`. It's safe to run as often as you like.

> **One-liner from your laptop** (push + trigger the VM update in a single command):
> ```bash
> git push && ssh <user>@scheduler.iitk.ac.in 'cd /opt/rsp && ./deploy/update.sh'
> ```
> **Sudo:** the script restarts the service and writes to `/var/www/rsp`, so give the
> deploy user passwordless sudo for just those, e.g. in `sudo visudo`:
> ```
> rsp ALL=(root) NOPASSWD: /bin/systemctl restart rsp, /usr/bin/rsync
> ```
> **Schema changes:** the app auto-creates NEW tables on restart but does NOT alter
> EXISTING ones. If an update adds a column to an existing table, run that ALTER (or an
> alembic migration) on the VM first — otherwise the API errors. New tables need nothing.

Make the script executable once (git may not preserve the +x bit on Windows):
```bash
chmod +x /opt/rsp/deploy/update.sh
```

## 14. If something breaks — where to look
| Symptom | Look at |
|---|---|
| 502 Bad Gateway | backend down → `systemctl status rsp`, `journalctl -u rsp -e` |
| Site won't load / cert error | `sudo nginx -t`, `journalctl -u nginx`, cert paths in nginx.conf |
| Login/API 500s | `journalctl -u rsp -f` while reproducing; check `.env` DB URL |
| App won't start, "Refusing to start" | production config guard tripped — fix `.env` (secret/DB/CORS) |
| CORS error in browser console | `CORS_ORIGINS` in `.env` must exactly match the site origin |
