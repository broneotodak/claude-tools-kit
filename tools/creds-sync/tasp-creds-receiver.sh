#!/bin/sh
# tasp-creds-receiver — SSH forced-command target for Claude Code creds pushes.
#
# Reads a Claude Code credentials JSON blob from stdin and, after validating
# its shape and verifying the pushed expiresAt is not older than what is
# already on disk, writes it to the two consumer paths used by the panel:
#   /root/.claude/.credentials.json           (root-level claude ops)
#   /home/tasp-claude/.claude/.credentials.json   (per-turn panel spawns)
#
# Authorized via /root/.ssh/authorized_keys entry:
#   command="/usr/local/bin/tasp-creds-receiver",no-pty,no-port-forwarding,
#   no-X11-forwarding,no-agent-forwarding,from="100.93.211.9" ssh-ed25519 ...
#
# The existing /api/auth/refresh Mac-pull endpoint in /srv/tasp/app/server.mjs
# remains as a manual fallback for super_admin to trigger from the panel UI.

set -eu

ROOT_DST="/root/.claude/.credentials.json"
USER_DST="/home/tasp-claude/.claude/.credentials.json"
LOG="/var/log/tasp-creds-receiver.log"
TMP="$(mktemp /tmp/tasp-creds-receiver.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { printf '%s receiver: %s\n' "$(ts)" "$*" >> "$LOG"; }

# Cap stdin to 16 KiB — a normal creds blob is ~500 bytes; anything larger
# is malformed or hostile.
head -c 16384 > "$TMP"

if [ ! -s "$TMP" ]; then
  log "REJECT empty payload"
  exit 10
fi

# Validate shape + extract pushed expiresAt.
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

# Monotonicity check: refuse to write if the pushed expiresAt is older than
# what we already have. This stops a stale or replayed push from downgrading
# a live VPS.
if [ -f "$ROOT_DST" ]; then
  EXISTING_EXP=$(/usr/bin/node -e '
  try {
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(d.claudeAiOauth?.expiresAt || 0));
  } catch { process.stdout.write("0"); }
  ' "$ROOT_DST" 2>/dev/null || echo 0)
  if [ "$PUSHED_EXP" -le "$EXISTING_EXP" ]; then
    # Skip equal-or-older. Equal happens every 60s when the keychain hasn't
    # rotated yet — writing the same file 1440x/day is wasteful, and the
    # monotonic check is also our defense against stale-replay attacks.
    exit 0
  fi
fi

install -d -m 700 -o root -g root /root/.claude
install -m 600 -o root -g root "$TMP" "$ROOT_DST"

install -d -m 700 -o tasp-claude -g tasp-claude /home/tasp-claude/.claude
install -m 600 -o tasp-claude -g tasp-claude "$TMP" "$USER_DST"

log "OK wrote pushed_exp=$PUSHED_EXP iso=$(date -u -d @$((PUSHED_EXP/1000)) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo n/a)"
