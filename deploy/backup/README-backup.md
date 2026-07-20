# RSP — database backups

Nightly `pg_dump` of `rsp_db`, scheduled by a **systemd timer** (not cron — `cronie`
isn't guaranteed to be installed and the VM can't reach the internet to add it).

Runs as the **postgres** user, so it authenticates by peer auth over the local
socket — no database password is stored anywhere on disk.

---

## Install (once)

```bash
sudo install -m 755 /opt/rsp/deploy/backup/rsp-backup.sh /usr/local/bin/rsp-backup.sh
sudo install -m 644 /opt/rsp/deploy/backup/rsp-backup.service /etc/systemd/system/
sudo install -m 644 /opt/rsp/deploy/backup/rsp-backup.timer   /etc/systemd/system/

# backup dir: owned by postgres (who writes), group = your admin user (who copies
# dumps off the box), 750 so nobody else can read them.
sudo mkdir -p /var/backups/rsp
sudo chown postgres:"$(id -gn)" /var/backups/rsp
sudo chmod 750 /var/backups/rsp

sudo systemctl daemon-reload
sudo systemctl enable --now rsp-backup.timer
```

**Prove it works right now** (don't wait until 2am to find out it's broken):
```bash
sudo systemctl start rsp-backup.service
systemctl status rsp-backup.service --no-pager | tail -5
ls -lh /var/backups/rsp
systemctl list-timers rsp-backup.timer     # shows the next scheduled run
```

If it fails, read `journalctl -u rsp-backup -e`. SELinux is enforcing on this VM,
so if you see a permission denial, check `sudo ausearch -m avc -ts recent`.

---

## Verify a backup is actually restorable

**A backup you have never restored is not a backup — it's a hope.** Do this once
now, and again after any big change. It restores into a *throwaway* database, so
live data is never touched:

```bash
# 1. what's inside the dump?
pg_restore -l /var/backups/rsp/rsp_db_<STAMP>.dump | head

# 2. restore into a scratch DB
sudo -u postgres createdb rsp_restore_test
sudo -u postgres pg_restore -d rsp_restore_test /var/backups/rsp/rsp_db_<STAMP>.dump

# 3. sanity-check the data came back
sudo -u postgres psql -d rsp_restore_test -c "select count(*) from users;"
sudo -u postgres psql -d rsp_restore_test -c "select count(*) from events;"

# 4. clean up
sudo -u postgres dropdb rsp_restore_test
```

---

## Real restore (disaster recovery)

```bash
sudo systemctl stop rsp                      # stop the app writing
sudo -u postgres dropdb rsp_db
sudo -u postgres createdb rsp_db -O rsp
sudo -u postgres pg_restore -d rsp_db /var/backups/rsp/rsp_db_<STAMP>.dump
sudo systemctl start rsp
curl -s localhost:8000/health
```

---

## Get a copy OFF the VM (important)

These dumps sit on the **same disk as the database**. That covers a bad delete, a
broken migration, or corruption — but **not** losing the VM or its disk. Until the
institute provides backup storage, periodically pull a copy to your laptop:

```powershell
scp vmadmin@<VM_IP>:/var/backups/rsp/rsp_db_*.dump D:\rsp_backups\
```

(The group permission set above is what lets you do this without sudo.)

---

## Settings you might change

| Setting | Where | Default |
|---|---|---|
| Retention | `KEEP_DAYS` in `rsp-backup.sh` | 14 days |
| Time of day | `OnCalendar` in `rsp-backup.timer` | 02:00 daily |
| Destination | `DEST` in `rsp-backup.sh` | `/var/backups/rsp` |

After editing the timer: `sudo systemctl daemon-reload && sudo systemctl restart rsp-backup.timer`
