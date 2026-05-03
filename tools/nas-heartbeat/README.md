# nas-heartbeat

Posts a fleet pulse for the Ugreen NAS (`nas-ugreen` agent) every 60s. Reports disk free, services up (Gitea, MinIO, Kuma, n8n), uptime, RAM, Tailscale state.

## Canonical install: SSH + systemd user timer

Runs in user-space on the NAS (no sudo needed). Same shape as `tr-home-heartbeat.sh`.

### Files

- `heartbeat.sh` — the script (one-shot, run by the timer every 60s)
- `nas-heartbeat.service` — systemd user unit
- `nas-heartbeat.timer` — fires the service every 60s

### Deploy (from any tailnet machine with SSH access)

```bash
# 1. Compose env file with neo-brain creds, push to NAS (mode 600)
grep -E '^(NEO_BRAIN_URL|NEO_BRAIN_SERVICE_ROLE_KEY)=' ~/Projects/claude-tools-kit/.env \
  | ssh Neo@100.85.18.97 'cat > ~/.openclaw/fleet.env && chmod 600 ~/.openclaw/fleet.env'

# 2. Push the script
scp tools/nas-heartbeat/heartbeat.sh Neo@100.85.18.97:/volume1/homes/Neo/.local/bin/nas-heartbeat.sh
ssh Neo@100.85.18.97 'chmod +x ~/.local/bin/nas-heartbeat.sh'

# 3. Push systemd units + enable
scp tools/nas-heartbeat/nas-heartbeat.{service,timer} \
    Neo@100.85.18.97:/volume1/homes/Neo/.config/systemd/user/
ssh Neo@100.85.18.97 'systemctl --user daemon-reload && \
                       systemctl --user enable --now nas-heartbeat.timer'

# 4. Verify
ssh Neo@100.85.18.97 'systemctl --user list-timers nas-heartbeat.timer; \
                       tail -3 ~/.openclaw/logs/nas-heartbeat.log'
```

### Linger (one-time, requires sudo)

By default the user systemd manager dies on logout. To make the timer survive logout/reboot:

```bash
ssh Neo@100.85.18.97 'sudo loginctl enable-linger Neo'
```

Without linger, the heartbeat fires only while a Neo user session is active (e.g., open SSH session or NAS web UI session).

## Why not Docker?

Earlier iteration assumed no SSH access and shipped a `docker-compose.yml`. SSH was actually available — the agent is `Neo@100.85.18.97` (capital N, case-sensitive). The Docker path was deleted as dead code; this SSH/systemd install is the canonical one.

## Verify

Within ~60s of `systemctl --user start nas-heartbeat.timer`:
- `command.neotodak.com` fleet view shows `nas-ugreen` flip from `never` → `active`
- `~/.openclaw/logs/nas-heartbeat.log` shows `OK ok gitea=true minio=true kuma=true n8n=true disk=N%`
- supervisor agent posts `Welcome to the fleet 🤝` if it's the first time
