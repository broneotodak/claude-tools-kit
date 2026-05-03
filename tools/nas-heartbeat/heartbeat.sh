#!/bin/bash
# nas-heartbeat — Ugreen NAS fleet pulse to neo-brain agent_heartbeats every 60s.
# Same shape as tr-home-heartbeat.sh. User-space install, no sudo needed.
set -u

ENV_FILE="$HOME/.openclaw/fleet.env"
LOG="$HOME/.openclaw/logs/nas-heartbeat.log"
mkdir -p "$(dirname "$LOG")"

if [ ! -r "$ENV_FILE" ]; then
  echo "$(date -Iseconds) ERROR env file unreadable: $ENV_FILE" >> "$LOG"
  exit 0
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${NEO_BRAIN_URL:-}" ] || [ -z "${NEO_BRAIN_SERVICE_ROLE_KEY:-}" ]; then
  echo "$(date -Iseconds) ERROR env missing creds" >> "$LOG"
  exit 0
fi

# --- gather metrics -----------------------------------------------------------
# Disk free on /volume1 (the big RAID5)
DF=$(df -P /volume1 2>/dev/null | tail -1)
DISK_USED_PCT=$(echo "$DF" | awk '{print $5}' | tr -d '%')
DISK_FREE_GB=$(echo "$DF" | awk '{printf "%.1f", $4 / 1048576}')
DISK_TOTAL_GB=$(echo "$DF" | awk '{printf "%.1f", $2 / 1048576}')

# Memory used MB
MEM_USED_MB=$(free -m 2>/dev/null | awk '/^Mem:/ {print $3}')
MEM_USED_MB=${MEM_USED_MB:-null}

# Uptime seconds
UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo "null")

# Tailscale up — 100.x interface presence
TS_UP="false"
if ip addr 2>/dev/null | grep -qE 'inet 100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'; then TS_UP="true"; fi

# Service probes (200-399 = up)
probe() {
  local url="$1"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo "000")
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ] 2>/dev/null; then
    echo "true:$code"
  else
    echo "false:$code"
  fi
}

GITEA=$(probe http://127.0.0.1:3000/api/v1/version)
MINIO=$(probe http://127.0.0.1:9000/minio/health/live)
KUMA=$(probe http://127.0.0.1:3001/)
N8N=$(probe http://127.0.0.1:5678/)

GITEA_UP=${GITEA%:*}; GITEA_CODE=${GITEA#*:}
MINIO_UP=${MINIO%:*}; MINIO_CODE=${MINIO#*:}
KUMA_UP=${KUMA%:*};   KUMA_CODE=${KUMA#*:}
N8N_UP=${N8N%:*};     N8N_CODE=${N8N#*:}

# Status: ok by default; degraded on any tracked service down or disk >=92%
STATUS="ok"
if [ "$GITEA_UP" = "false" ] || [ "$MINIO_UP" = "false" ] || [ "$KUMA_UP" = "false" ]; then STATUS="degraded"; fi
if [ -n "$DISK_USED_PCT" ] && [ "$DISK_USED_PCT" -ge 92 ]; then STATUS="degraded"; fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PAYLOAD=$(cat <<JSON
{
  "agent_name": "nas-ugreen",
  "status": "$STATUS",
  "reported_at": "$NOW",
  "meta": {
    "version": "nas-heartbeat-v1",
    "disk_free_gb": $DISK_FREE_GB,
    "disk_total_gb": $DISK_TOTAL_GB,
    "disk_used_pct": $DISK_USED_PCT,
    "ram_used_mb": $MEM_USED_MB,
    "uptime_sec": $UPTIME_SEC,
    "tailscale_up": $TS_UP,
    "services": {
      "gitea": { "up": $GITEA_UP, "code": $GITEA_CODE },
      "minio": { "up": $MINIO_UP, "code": $MINIO_CODE },
      "kuma":  { "up": $KUMA_UP,  "code": $KUMA_CODE  },
      "n8n":   { "up": $N8N_UP,   "code": $N8N_CODE   }
    }
  }
}
JSON
)

HTTP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X POST "$NEO_BRAIN_URL/rest/v1/agent_heartbeats" \
  -H "apikey: $NEO_BRAIN_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $NEO_BRAIN_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  --data "$PAYLOAD" 2>&1)

if [ "$HTTP" = "201" ] || [ "$HTTP" = "200" ]; then
  echo "$(date -Iseconds) OK $STATUS gitea=$GITEA_UP minio=$MINIO_UP kuma=$KUMA_UP n8n=$N8N_UP disk=${DISK_USED_PCT}%" >> "$LOG"
else
  echo "$(date -Iseconds) FAIL http=$HTTP" >> "$LOG"
fi

# Cap log to last 5000 lines
if [ -s "$LOG" ]; then
  LINES=$(wc -l < "$LOG")
  if [ "$LINES" -gt 5000 ]; then
    tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
fi

exit 0
