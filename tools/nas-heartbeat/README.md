# nas-heartbeat

Tiny container that posts a fleet pulse for the Ugreen NAS (`ugreen-nas-1` agent) every 60s. Reports disk free, services up (Gitea, MinIO, Kuma), uptime.

## Why a container

NAS doesn't have my SSH key, so a launchd-style script needs Neo's hands. Container deploy is trivial via Ugreen Container Manager web UI — no SSH required.

## Deploy on Ugreen NAS

1. Ugreen NAS web UI → Container Manager → Compose
2. Paste `docker-compose.yml` from this folder
3. Upload `heartbeat.sh` next to it (or mount via the GUI's volume mapping)
4. Set environment variables (in the GUI's env editor):
   - `NEO_BRAIN_URL` = `https://xsunmervpyrplzarebva.supabase.co`
   - `NEO_BRAIN_SERVICE_ROLE_KEY` = retrieve from neo-brain credentials vault: `service='neo_brain', type='service_role'` (NEVER paste plaintext into Git)
5. Start the container

## Verify

Within ~60s of starting, `command.neotodak.com` fleet view should show `ugreen-nas-1` flip from "never" → "active". Container logs (Ugreen UI) should show `OK ok gitea=true minio=true kuma=true disk=N%`.

## Uninstall

Stop + remove the container in Container Manager. neo-brain `agent_heartbeats` row stays (will go stale → offline within 5min).
