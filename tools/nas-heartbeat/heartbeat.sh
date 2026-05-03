#!/bin/sh
# nas-heartbeat — Ugreen NAS fleet pulse, intended to run inside a Docker container.
# Loops every 60s, posts to neo-brain agent_heartbeats.
# Status logic: ok by default; degraded if any tracked Docker service is down or disk >92%.

set -u

NEO_BRAIN_URL="${NEO_BRAIN_URL:?env var required}"
NEO_BRAIN_SERVICE_ROLE_KEY="${NEO_BRAIN_SERVICE_ROLE_KEY:?env var required}"
INTERVAL="${INTERVAL:-60}"

# Endpoints to probe — host is whatever the container resolves "host.docker.internal" or NAS LAN IP to.
# Default values target the NAS internal services.
GITEA_URL="${GITEA_URL:-http://host.docker.internal:3000/api/v1/version}"
MINIO_URL="${MINIO_URL:-http://host.docker.internal:9000/minio/health/live}"
KUMA_URL="${KUMA_URL:-http://host.docker.internal:3001/}"

probe() {
  local url="$1"
  curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000"
}

while true; do
  NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Disk free on / (where the container is mounted)
  DF_LINE=$(df -P / 2>/dev/null | tail -1)
  DISK_USED_PCT=$(echo "$DF_LINE" | awk '{print $5}' | tr -d '%')
  DISK_FREE_GB=$(echo "$DF_LINE" | awk '{printf "%.1f", $4 / 1048576}')

  # Memory used MB (best-effort — container may not see host memory)
  MEM_USED_MB=$(awk '/^MemAvailable/ {avail=$2} /^MemTotal/ {total=$2} END {if (total) print int((total-avail)/1024)}' /proc/meminfo 2>/dev/null || echo "null")

  # Uptime seconds (host uptime if /proc/uptime accessible)
  UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo "null")

  # Service probes
  GITEA_CODE=$(probe "$GITEA_URL")
  MINIO_CODE=$(probe "$MINIO_URL")
  KUMA_CODE=$(probe "$KUMA_URL")

  GITEA_UP=$([ "$GITEA_CODE" = "200" ] && echo true || echo false)
  MINIO_UP=$([ "$MINIO_CODE" = "200" ] && echo true || echo false)
  KUMA_UP=$([ "$KUMA_CODE" = "200" ] && echo true || echo false)

  STATUS="ok"
  [ "$GITEA_UP" = "false" ] || [ "$MINIO_UP" = "false" ] || [ "$KUMA_UP" = "false" ] && STATUS="degraded"
  [ -n "$DISK_USED_PCT" ] && [ "$DISK_USED_PCT" -ge 92 ] && STATUS="degraded"

  META=$(cat <<EOF
{
  "version": "nas-heartbeat-v1",
  "disk_free_gb": $DISK_FREE_GB,
  "disk_used_pct": $DISK_USED_PCT,
  "ram_used_mb": $MEM_USED_MB,
  "uptime_sec": $UPTIME_SEC,
  "services": {
    "gitea": { "up": $GITEA_UP, "code": $GITEA_CODE },
    "minio": { "up": $MINIO_UP, "code": $MINIO_CODE },
    "kuma":  { "up": $KUMA_UP,  "code": $KUMA_CODE  }
  }
}
EOF
)

  PAYLOAD=$(printf '{"agent_name":"nas-ugreen","status":"%s","reported_at":"%s","meta":%s}' "$STATUS" "$NOW" "$META")

  HTTP=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -X POST "$NEO_BRAIN_URL/rest/v1/agent_heartbeats" \
    -H "apikey: $NEO_BRAIN_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $NEO_BRAIN_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    --data "$PAYLOAD" 2>&1)

  if [ "$HTTP" = "201" ] || [ "$HTTP" = "200" ]; then
    echo "$(date -Iseconds) OK $STATUS gitea=$GITEA_UP minio=$MINIO_UP kuma=$KUMA_UP disk=${DISK_USED_PCT}%"
  else
    echo "$(date -Iseconds) FAIL http=$HTTP"
  fi

  sleep "$INTERVAL"
done
