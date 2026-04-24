#!/bin/bash
# backup-sync.sh
# Nightly backup orchestrator, runs on CLAW at 03:00 MYT via launchd.
#   1. Logical snapshot of neo-brain tables  → NAS /volume1/docker/backups/neo-brain/<date>/
#   2. rsync CLAW local state                → NAS /volume1/docker/backups/claw/<date>/
#   3. rsync configs from reachable VPSes    → NAS /volume1/docker/backups/configs/<vps>/<date>/
#   4. Retention: keep last 14 daily snapshots per target
#   5. Push heartbeat to Uptime Kuma + write agent_heartbeats row
#
# Idempotent: re-running on the same day overwrites that day's files.
# Exit status: 0 = all ok, non-zero = at least one sub-task failed.

set -uo pipefail

DATE=$(date +%Y-%m-%d)
TS=$(date -Iseconds)
NAS="${BACKUP_SSH_TARGET:-nas-remote}"
REMOTE_ROOT="${BACKUP_REMOTE_ROOT:-/volume1/docker/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
CTK="${CTK_HOME:-$HOME/Projects/claude-tools-kit}"
SECRETS="$HOME/.openclaw/secrets"

# Resolve node path — launchd has a bare PATH
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
RSYNC_BIN="$(command -v rsync || echo /usr/bin/rsync)"
SSH_BIN="$(command -v ssh || echo /usr/bin/ssh)"
CURL_BIN="$(command -v curl || echo /usr/bin/curl)"

LOG_FILE="$HOME/.openclaw/logs/backup-sync.log"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "────────────────────────────────────────"
echo "[backup-sync] $TS start — date=$DATE nas=$NAS"

declare -i ERRORS=0
declare -a SUBTASKS=()

run_step() {
  local name="$1"; shift
  local t0 t1 status
  t0=$(date +%s)
  echo "[backup-sync] ▶ $name"
  if "$@"; then
    t1=$(date +%s)
    echo "[backup-sync] ✓ $name — $((t1-t0))s"
    SUBTASKS+=("$name:ok:$((t1-t0))s")
  else
    t1=$(date +%s)
    status=$?
    echo "[backup-sync] ✗ $name — exit $status after $((t1-t0))s"
    SUBTASKS+=("$name:fail:$((t1-t0))s:exit=$status")
    ERRORS+=1
  fi
}

# ── 1) neo-brain snapshot ────────────────────────────────────────────
step_neo_brain_snapshot() {
  NEO_BRAIN_ENV_PATH="$SECRETS/neo-brain.env" \
  BACKUP_SSH_TARGET="$NAS" \
  BACKUP_REMOTE_ROOT="$REMOTE_ROOT/neo-brain" \
    "$NODE_BIN" "$CTK/tools/backup-neo-brain.mjs" "$DATE"
}

# ── 2) CLAW local state → NAS (tar-over-ssh; Synology rsyncd has path restrictions) ──
tar_to_nas() {
  local label="$1" src_dir="$2" archive_name="$3" dest_dir="$4"
  local exclude_args="${5:-}"
  # shellcheck disable=SC2086
  tar -cz $exclude_args -C "$src_dir" . \
    | "$SSH_BIN" "$NAS" "mkdir -p '$dest_dir' && cat > '$dest_dir/$archive_name'" \
    || { echo "[backup-sync]     (warn: $label tar failed)"; return 1; }
}

step_claw_rsync() {
  local dest="$REMOTE_ROOT/claw/$DATE"
  "$SSH_BIN" "$NAS" "mkdir -p '$dest'" || return 1
  local failed=0
  # openclaw: include only small, non-reproducible dirs.
  # Excludes the fat stuff: browser profile (~2GB), media artifacts, workspace sandboxes,
  # logs (ephemeral), tools/ (444M remotion install), credentials/ (separate binary cache).
  tar_to_nas "openclaw-core" "$HOME/.openclaw" "openclaw-core.tar.gz" "$dest" \
    "--exclude=browser --exclude=media --exclude=logs --exclude=workspace --exclude=sandboxes --exclude=tools --exclude=credentials --exclude=.DS_Store" \
    || failed=1
  tar_to_nas "LaunchAgents" "$HOME/Library/LaunchAgents" "LaunchAgents.tar.gz" "$dest" "--exclude=.DS_Store" || failed=1
  tar_to_nas "ctk-projects" "$CTK/projects"            "ctk-projects.tar.gz" "$dest" "--exclude=node_modules --exclude=.git --exclude='*.log' --exclude=dist --exclude=build" || failed=1
  return $failed
}

# ── 3) VPS configs → NAS ────────────────────────────────────────────
# DISABLED in Phase 1 — Siti/NACA VPS uses Tailscale SSH which requires interactive
# browser auth. Phase 2 supervisor-agent will re-enable this once ACL tags allow
# non-interactive ssh from backup-sync/supervisor identities.
step_vps_rsync() {
  echo "[backup-sync]   (skipped — Tailscale SSH blocks non-interactive auth; re-enable in Phase 2 with tagged ACL)"
  return 0
}

# ── 4) Retention ─────────────────────────────────────────────────────
step_retention() {
  "$SSH_BIN" "$NAS" bash -s <<BASH
set -e
RETAIN=$RETAIN_DAYS
for dir in $REMOTE_ROOT/neo-brain $REMOTE_ROOT/claw $REMOTE_ROOT/configs/*; do
  [ -d "\$dir" ] || continue
  # list date-named children, sort desc, delete past RETAIN
  ls -1 "\$dir" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\$' | sort -r | tail -n +\$((RETAIN+1)) | while read d; do
    echo "  prune \$dir/\$d"
    rm -rf "\$dir/\$d"
  done
done
BASH
}

# ── 5) Heartbeat + WhatsApp notify ──────────────────────────────────
step_heartbeat() {
  # Push to Uptime Kuma (token fetched from neo-brain vault on first run, cached locally)
  local cache="$SECRETS/backup-sync-push.url"
  if [ ! -f "$cache" ] && [ -n "${BACKUP_PUSH_URL:-}" ]; then
    printf '%s' "$BACKUP_PUSH_URL" > "$cache"
  fi
  if [ -f "$cache" ]; then
    local url; url="$(cat "$cache")"
    local status="up"; [ "$ERRORS" -gt 0 ] && status="down"
    "$CURL_BIN" -sS -o /dev/null --max-time 10 "${url/&status=up/&status=$status}" || true
  fi

  # Measure total size of this night's backup on NAS (best-effort; missing dir = 0).
  local size_out
  size_out=$("$SSH_BIN" "$NAS" "du -sh '$REMOTE_ROOT/neo-brain/$BS_DATE' '$REMOTE_ROOT/claw/$BS_DATE' 2>/dev/null; du -sh '$REMOTE_ROOT/' 2>/dev/null" 2>/dev/null || true)
  export BS_SIZE_NB="$(echo "$size_out" | grep "/neo-brain/$BS_DATE" | awk '{print $1}')"
  export BS_SIZE_CL="$(echo "$size_out" | grep "/claw/$BS_DATE"      | awk '{print $1}')"
  export BS_SIZE_TOTAL="$(echo "$size_out" | tail -1 | awk '{print $1}')"

  # Write agent_heartbeats row AND dispatch a Siti WhatsApp notification.
  NEO_BRAIN_ENV_PATH="$SECRETS/neo-brain.env" \
  BS_NOTIFY_TO="${BS_NOTIFY_TO:-60177519610}" \
    "$NODE_BIN" - <<'JS'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const envPath = process.env.NEO_BRAIN_ENV_PATH || `${homedir()}/.openclaw/secrets/neo-brain.env`;
const env = Object.fromEntries(readFileSync(envPath,'utf8').split('\n')
  .filter(l=>l && !l.trimStart().startsWith('#'))
  .map(l=>{const i=l.indexOf('='); return i<0?null:[l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];})
  .filter(Boolean));
const URL = env.NEO_BRAIN_URL; const KEY = env.NEO_BRAIN_SERVICE_ROLE_KEY;
const errors = parseInt(process.env.BS_ERRORS || '0', 10);
const status = errors === 0 ? 'ok' : 'degraded';
const subtasks = (process.env.BS_SUBTASKS || '').split('|').filter(Boolean);
const durationSec = parseInt(process.env.BS_DURATION || '0', 10);
const mm = Math.floor(durationSec / 60), ss = durationSec % 60;
const durationStr = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;

// Normalize `du -sh` shorthand (e.g. "32M", "1.7G") → universal units "32 MB", "1.7 GB".
const niceSize = (s) => {
  if (!s) return null;
  const m = String(s).match(/^([\d.]+)\s*([KMGTP])?$/i);
  if (!m) return s;
  const u = (m[2] || '').toUpperCase();
  return `${m[1]} ${u ? u + 'B' : 'B'}`;
};
const sizeNB    = niceSize(process.env.BS_SIZE_NB);
const sizeCL    = niceSize(process.env.BS_SIZE_CL);
const sizeTotal = niceSize(process.env.BS_SIZE_TOTAL);

const meta = {
  version: 'backup-sync-v1',
  date: process.env.BS_DATE,
  errors,
  subtasks,
  duration_sec: durationSec,
  size_neo_brain: sizeNB,
  size_claw: sizeCL,
  size_total: sizeTotal,
};

const post = (path, body) => fetch(`${URL}/rest/v1/${path}`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(body),
});

// 1) Heartbeat (upsert)
{
  const r = await post('agent_heartbeats?on_conflict=agent_name',
    { agent_name: 'backup-sync', status, meta, reported_at: new Date().toISOString() });
  if (!r.ok) console.error('heartbeat write failed', r.status, await r.text());
  else console.log('[backup-sync] heartbeat written');
}

// 2) Append one memory row per run so verify-agents can see 7-day history
try {
  await post('memories', {
    content: `backup-sync ${status} — ${process.env.BS_DATE} · ${errors} errors · ${durationStr} · neo-brain=${meta.size_neo_brain || '?'}, claw=${meta.size_claw || '?'}`,
    category: 'infrastructure',
    type: 'event',
    importance: 3,
    visibility: 'private',
    source: 'backup-sync',
    metadata: meta,
  });
} catch (e) { console.error('memory write failed', e.message); }

// 3) Siti WhatsApp notification
const fmtStep = (s) => {
  const [name, state] = s.split(':');
  const ok = state === 'ok';
  return `${ok ? '✓' : '✗'} ${name}`;
};
const lines = [];
lines.push(`━━ 💾 backup-sync ━━`);
if (errors === 0) {
  lines.push(`✅ *Nightly Backup Complete*`);
} else {
  lines.push(`⚠️ *Nightly Backup Had Errors*`);
}
lines.push('');
lines.push(`📅 ${process.env.BS_DATE}`);
if (meta.size_neo_brain || meta.size_claw) {
  const parts = [];
  if (meta.size_neo_brain) parts.push(`neo-brain ${meta.size_neo_brain}`);
  if (meta.size_claw) parts.push(`claw ${meta.size_claw}`);
  lines.push(`📦 ${parts.join(' · ')}`);
}
if (meta.size_total) lines.push(`🗃️ NAS total: ${meta.size_total}`);
lines.push(`⏱️ ${durationStr}`);
lines.push('');
lines.push(subtasks.map(fmtStep).join('  '));
if (errors > 0) {
  lines.push('');
  lines.push(`Log: ~/.openclaw/logs/backup-sync.log`);
}
const message = lines.join('\n');

try {
  const r = await post('agent_commands', {
    from_agent: 'backup-sync',
    to_agent: 'siti',
    command: 'send_whatsapp_notification',
    payload: { to: process.env.BS_NOTIFY_TO, message },
    priority: 3,
  });
  if (!r.ok) console.error('siti notify queue failed', r.status, await r.text());
  else console.log('[backup-sync] siti notification queued');
} catch (e) { console.error('siti notify error', e.message); }
JS
}

# ── Run ──────────────────────────────────────────────────────────────
T0=$(date +%s)
run_step "neo-brain-snapshot" step_neo_brain_snapshot
run_step "claw-rsync"        step_claw_rsync
run_step "vps-rsync"         step_vps_rsync
run_step "retention"         step_retention

T1=$(date +%s)
export BS_DATE="$DATE"
export BS_ERRORS="$ERRORS"
export BS_DURATION="$((T1-T0))"
export BS_SUBTASKS="$(IFS=\|; echo "${SUBTASKS[*]}")"
run_step "heartbeat"         step_heartbeat

T2=$(date +%s)
echo "[backup-sync] done — errors=$ERRORS duration=$((T2-T0))s"
echo "[backup-sync] subtasks: ${SUBTASKS[*]}"
exit "$ERRORS"
