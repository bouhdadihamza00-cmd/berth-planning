# Client trial on Oracle Cloud Always Free

Deploy from a fresh GitHub clone. Never upload a developer database, `.env`, connector session, or the local `data/` folder. The image contains only application code; setup creates one empty workspace with no operational records.

## Server

Use an Always Free-eligible Ubuntu Ampere A1 instance in the account's home region, within the current free allocation. A single VM with 2 OCPUs, 12 GB RAM and a 50 GB boot disk fits Oracle's published free limits as checked on 19 November 2026. Verify the console still labels the selected resources free before creating them. Capacity is not guaranteed and idle instances can be reclaimed.

Allow inbound TCP 80 and 443. Restrict SSH (22) to the operator's IP. Do not expose 8000. Install Docker Engine and the Compose plugin using [Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).

## Deploy

Clone the repository into `/opt/portside` on the new VM, then run commands from that directory:

```sh
git clone https://github.com/bouhdadihamza00-cmd/berth-planning.git /opt/portside
cd /opt/portside
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

Set `PORTSIDE_HOST` in `deploy/.env` to a public hostname that resolves to the VM. The hostname must have no scheme, slash or port. Confirm DNS and firewall access before starting the proxy. No API credentials or administrator password belong in this file.

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml build app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps app python scripts/create_workspace.py
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

The setup command prompts for a new administrator email and password, organization and initial port. It refuses to overwrite a database with existing users. Run it only for first installation. Store the client credentials privately; create named users through Configuration → People rather than sharing the operator account.

The proxy obtains and renews HTTPS certificates. The application trusts forwarded headers only within its unpublished container network; this makes secure session cookies and same-origin checks work behind the proxy. The app has no public host port. AI and vessel tracking begin disabled; weather needs no copied credentials.

Validate the trial before sharing the URL:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
curl --fail https://YOUR_HOST/api/health
```

Sign in, confirm the workspace has no operational records, create a test berth and call, then restart the app and verify the records remain. Check map/weather loading, uploads, exports and client permissions using synthetic test records. Remove those test records before handover if the client wants an empty workspace.

## Backups

Original uploaded documents are stored in SQLite with the operational records. The backup command uses SQLite's online backup API, verifies database integrity, writes private files and retains 14 days of snapshots:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T app python scripts/backup_workspace.py
```

Install this entry in the deployment operator's crontab after running the command successfully. It runs at 02:00 in the VM's configured timezone:

```cron
0 2 * * * cd /opt/portside && /usr/bin/docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T app python scripts/backup_workspace.py
```

Backups live in `/app/data/backups` on the data volume. Copy backups off the VM regularly; a copy on the same VM cannot recover from VM or volume deletion. Restore only with the app stopped, verify `PRAGMA integrity_check`, and keep the previous database until the restored workspace has been checked.

## Update or stop

```sh
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T app python scripts/backup_workspace.py
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

Use `docker compose --env-file deploy/.env -f deploy/compose.yaml stop` to stop the trial. Do not use `down -v`: it deletes the client database and certificate volumes. The image includes the setup and backup commands, but never a database or default credentials.

References: [Oracle Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [Compose health checks](https://docs.docker.com/compose/how-tos/startup-order/).
