#!/usr/bin/env bash
# add-fleet-node.sh
# Operator-side script: run from Neo's MBP to provision a new fleet machine
# (Imel's M3, future Digitech recycles, etc.) AFTER they've run
# install-fleet-node.sh on their side and sent you their hostname + Tailscale IP.
#
# Pushes:
#   - ~/.openclaw/secrets/neo-brain.env   (scp, 600)
#   - mac-heartbeat.js + plist            (rendered with their HOME path)
# Then loads launchd → first heartbeat fires within 60s → supervisor sees a
# new agent_name → notifies Neo via Siti WhatsApp.
#
# Usage:
#   add-fleet-node.sh <ssh_user> <tailscale_ip>
#   e.g.  add-fleet-node.sh imel 100.x.x.x

set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; BLU=$'\e[34m'; OFF=$'\e[0m'

if [ $# -lt 2 ]; then
  echo "${YEL}usage:${OFF} $0 <ssh_user> <tailscale_ip>"
  echo "       $0 imel 100.123.45.67"
  exit 1
fi

SSH_USER="$1"
TS_IP="$2"
TARGET="$SSH_USER@$TS_IP"
CTK="$HOME/Projects/claude-tools-kit"

# ── 1) preflight ────────────────────────────────────────────────────
echo "${BLU}▸${OFF} Preflight: SSH reachability + remote tooling"
ssh -o ConnectTimeout=5 -o BatchMode=yes "$TARGET" 'bash -l -c "which node; sw_vers -productVersion"' \
  || { echo "${RED}✗${OFF} cannot ssh to $TARGET — has Imel run install-fleet-node.sh and shared her pubkey with you?"; exit 1; }
echo "${GRN}✓${OFF} reachable"

REMOTE_HOME=$(ssh "$TARGET" 'echo $HOME')
REMOTE_HOSTNAME=$(ssh "$TARGET" 'scutil --get LocalHostName 2>/dev/null || hostname -s')
echo "${BLU}▸${OFF} remote HOME=$REMOTE_HOME  hostname=$REMOTE_HOSTNAME"

# ── 2) push neo-brain.env ───────────────────────────────────────────
ENV_SRC="$HOME/.openclaw/secrets/neo-brain.env"
[ -f "$ENV_SRC" ] || { echo "${RED}✗${OFF} $ENV_SRC missing on this machine"; exit 1; }

echo "${BLU}▸${OFF} Pushing neo-brain.env to $TARGET"
ssh "$TARGET" "mkdir -p $REMOTE_HOME/.openclaw/secrets $REMOTE_HOME/.openclaw/logs && chmod 700 $REMOTE_HOME/.openclaw/secrets"
scp -q "$ENV_SRC" "$TARGET:$REMOTE_HOME/.openclaw/secrets/neo-brain.env"
ssh "$TARGET" "chmod 600 $REMOTE_HOME/.openclaw/secrets/neo-brain.env"
echo "${GRN}✓${OFF} neo-brain.env in place"

# ── 3) push mac-heartbeat.js + render plist with remote $HOME ───────
echo "${BLU}▸${OFF} Pushing mac-heartbeat.js + rendering plist"
# install-fleet-node.sh already cloned CTK so the file is technically there,
# but pull latest to be sure.
ssh "$TARGET" "cd $REMOTE_HOME/Projects/claude-tools-kit && git pull --rebase --quiet" \
  || { echo "${YEL}⚠${OFF} git pull on remote CTK failed — falling back to scp"; \
       scp -q "$CTK/tools/mac-heartbeat.js" "$TARGET:$REMOTE_HOME/Projects/claude-tools-kit/tools/mac-heartbeat.js"; }

# Render plist on Neo's machine, then scp
PLIST_LOCAL="/tmp/ai.openclaw.mac-heartbeat-${REMOTE_HOSTNAME}.plist"
sed "s|{{HOME}}|$REMOTE_HOME|g" "$CTK/tools/ai.openclaw.mac-heartbeat.plist" > "$PLIST_LOCAL"
scp -q "$PLIST_LOCAL" "$TARGET:$REMOTE_HOME/Library/LaunchAgents/ai.openclaw.mac-heartbeat.plist"
rm -f "$PLIST_LOCAL"

# ── 4) load launchd ─────────────────────────────────────────────────
echo "${BLU}▸${OFF} Loading launchd"
ssh "$TARGET" "
  launchctl unload $REMOTE_HOME/Library/LaunchAgents/ai.openclaw.mac-heartbeat.plist 2>/dev/null
  launchctl load -w $REMOTE_HOME/Library/LaunchAgents/ai.openclaw.mac-heartbeat.plist
  sleep 5
  echo '── first heartbeat output ──'
  tail -5 $REMOTE_HOME/.openclaw/logs/mac-heartbeat.log 2>/dev/null
"

# ── 5) confirm via neo-brain ────────────────────────────────────────
echo
echo "${BLU}▸${OFF} Polling neo-brain for first heartbeat (≤60s)…"
SLUG=$(echo "$REMOTE_HOSTNAME" | tr '[:upper:]' '[:lower:]' | sed 's/\.local$//' | sed 's/[^a-z0-9-]/-/g')
EXPECTED="mac-${SLUG}"
echo "  expected agent_name: $EXPECTED"

# ── 6) done ─────────────────────────────────────────────────────────
echo
echo "${GRN}✅ Bootstrap complete${OFF}"
echo
echo "Next 60s: supervisor on CLAW will detect the new agent_name '$EXPECTED'"
echo "and you'll get a WhatsApp ping from Siti."
echo
echo "Verify yourself in:"
echo "  • https://presentation.neotodak.com/agentic-live.html"
echo "  • NACA HQ tab"
