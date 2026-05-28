#!/bin/sh
# tdcc-creds-receiver — SSH forced-command target for Claude Code creds pushes
# on the TDCC VPS (5.223.80.244, BroLanTodak/tdcc).
#
# Reads a Claude Code credentials JSON blob from stdin and, after validating
# shape and confirming the pushed expiresAt is not older than what is already
# on disk, writes it ONLY to /home/lanccc/.claude/.credentials.json. The
# existing /etc/cron.d/claude-sync fans it out to /home/kamiera and /home/neo
# at the next :00. For instant fan-out (when a user clicks the "Renew auth"
# button in the TDCC web UI), the backend's POST /api/auth/refresh handler
# re-runs that copy out-of-band.
#
# Authorized via /root/.ssh/authorized_keys entry:
#   command="/usr/local/bin/tdcc-creds-receiver",no-pty,no-port-forwarding,
#   no-X11-forwarding,no-agent-forwarding ssh-ed25519 ...
#
# (No from= IP pin — Neo's MBP source IP varies, and the forced-command +
# monotonic-receiver are the security boundary.)

set -eu

DST="/home/lanccc/.claude/.credentials.json"
LOG="/var/log/tdcc-creds-receiver.log"
TMP="$(mktemp /tmp/tdcc-creds-receiver.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { printf '%s receiver: %s\n' "$(ts)" "$*" >> "$LOG"; }

head -c 16384 > "$TMP"

if [ ! -s "$TMP" ]; then
  log "REJECT empty payload"
  exit 10
fi

PUSHED_EXP=$(/usr/bin/node -e '
let buf="";process.stdin.on("data",c=>buf+=c).on("end",()=>{
  try {
    const d = JSON.parse(buf);
    const o = d.claudeAiOauth;
    if (!o || typeof o.expiresAt !== "number") throw new Error("missing claudeAiOauth.expiresAt");
    if (!o.accessToken || !o.refreshToken) throw new Error("missing tokens");
    if (!Array.isArray(o.scopes) || o.scopes.length === 0) throw new Error("missing scopes");
    process.stdout.write(String(o.expiresAt));
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
});
' < "$TMP" 2>"$TMP.err") || { log "REJECT shape: $(cat "$TMP.err" 2>/dev/null)"; rm -f "$TMP.err"; exit 11; }
rm -f "$TMP.err"

if [ -f "$DST" ]; then
  EXISTING_EXP=$(/usr/bin/node -e '
  try {
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(d.claudeAiOauth?.expiresAt || 0));
  } catch { process.stdout.write("0"); }
  ' "$DST" 2>/dev/null || echo 0)
  if [ "$PUSHED_EXP" -le "$EXISTING_EXP" ]; then
    # Skip equal-or-older — same monotonic-replay guard as TASP.
    exit 0
  fi
fi

install -d -m 700 -o lanccc -g lanccc /home/lanccc/.claude
install -m 600 -o lanccc -g lanccc "$TMP" "$DST"

log "OK wrote pushed_exp=$PUSHED_EXP iso=$(date -u -d @$((PUSHED_EXP/1000)) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo n/a)"
