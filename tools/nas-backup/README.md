# nas-backup — nightly neo-brain snapshot, running ON the NAS

Successor to the CLAW-hosted `backup-sync.sh` (CLAW retired 2026-07). The
backup now runs where the data lands — a Docker container on the Ugreen NAS —
so the data path has **zero network hops** (the July 2026 relay-stall failure
mode can't occur).

## What runs

- `run.mjs` (this dir) orchestrates: snapshot → 14-day retention prune → report.
- The snapshot itself is `../backup-neo-brain.mjs` in `BACKUP_LOCAL_DIR` mode.
- Reporting is identical to the CLAW era: `agent_heartbeats` upsert as
  `backup-sync`, a `memories` row (category `backup_run` — registered in
  `memory_event_categories` 2026-07-19; the old `infrastructure` category was
  never allowlisted, so post-May memory rows were silently rejected), and a
  Siti WhatsApp summary via `agent_commands`.

## Deploy (on the NAS, as root via `sudo`)

```sh
mkdir -p /volume1/docker/naca-backup/app
# copy run.mjs + backup-neo-brain.mjs into app/ (scp from a CTK checkout)
cat > /volume1/docker/naca-backup/env <<'EOF'
NEO_BRAIN_URL=…
NEO_BRAIN_SERVICE_ROLE_KEY=…
BACKUP_LOCAL_DIR=/backups
BS_NOTIFY_TO=60177519610
EOF
chmod 600 /volume1/docker/naca-backup/env

docker run -d --name neo-brain-backup --restart unless-stopped \
  --env-file /volume1/docker/naca-backup/env \
  -v /volume1/docker/backups/neo-brain:/backups \
  -v /volume1/docker/naca-backup/app:/app:ro \
  node:20-alpine \
  sh -c 'echo "0 19 * * * node /app/run.mjs >> /backups/nas-backup.log 2>&1" | crontab - && exec crond -f -l 8'
```

`0 19 * * *` UTC = **03:00 MYT**, matching the historical schedule and MYT
date-labeled folders.

## Manual test run

```sh
docker exec neo-brain-backup node /app/run.mjs
tail -5 /volume1/docker/backups/neo-brain/nas-backup.log
```

## Notes

- The container is stock `node:20-alpine` with the two scripts bind-mounted
  read-only — update = replace files in `app/`, no image rebuild.
- The `agent_metrics` table (1.5M+ rows) dominates runtime; offset pagination
  is slow but tolerated at 03:00. If runtime becomes a problem, add keyset
  pagination for bigint-id tables.
- Watched by the tasp watchtower: supervisor pages if the `backup-sync`
  heartbeat goes stale > 26h.
- CLAW split-brain guard: if CLAW is ever powered on again, DISABLE its
  `ai.openclaw.backup-sync` launchd job first (see the CLAW first-boot
  checklist memory in neo-brain).
