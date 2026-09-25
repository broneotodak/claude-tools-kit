#!/usr/bin/env bash
# install.sh — put the sentinel on a fleet box and schedule it (idempotent).
#
#   tools/sentinel/install.sh <ssh-target> <name> <env-file-on-box>
#
#   <ssh-target>       e.g. edge · root@100.120.79.126 · nas-remote
#   <name>             heartbeat name, e.g. sentinel-edge
#   <env-file-on-box>  an env file ALREADY on that box holding NEO_BRAIN_URL +
#                      NEO_BRAIN_SERVICE_ROLE_KEY (the sentinel reads it in place —
#                      no key is ever copied, nothing passes through this Mac)
#
# Installs ~/.naca/sentinel/sentinel.py, adds one crontab line (*/10, flock),
# runs a first --reset baseline and prints its line. Mac: use install-mac.sh.
set -euo pipefail
TARGET=${1:?ssh target}; NAME=${2:?sentinel name}; ENVF=${3:?env file on box}
HERE=$(cd "$(dirname "$0")" && pwd)
SSH="ssh -o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new"
$SSH "$TARGET" 'mkdir -p ~/.naca/sentinel && chmod 700 ~/.naca/sentinel'
$SSH "$TARGET" 'cat > ~/.naca/sentinel/sentinel.py' < "$HERE/sentinel.py"
$SSH "$TARGET" "test -r '$ENVF' && grep -q 'NEO_BRAIN_URL' '$ENVF'" || { echo "!! $ENVF not readable or has no NEO_BRAIN_URL on $TARGET"; exit 2; }
LINE="*/10 * * * * /usr/bin/env SENTINEL_ENV=$ENVF SENTINEL_NAME=$NAME flock -n /tmp/sentinel-\$(id -u).lock python3 \$HOME/.naca/sentinel/sentinel.py >> \$HOME/.naca/sentinel/sentinel.log 2>&1"
# flock may be missing on the NAS (UGOS) — fall back to a plain line
$SSH "$TARGET" 'command -v flock >/dev/null' || LINE="*/10 * * * * /usr/bin/env SENTINEL_ENV=$ENVF SENTINEL_NAME=$NAME python3 \$HOME/.naca/sentinel/sentinel.py >> \$HOME/.naca/sentinel/sentinel.log 2>&1"
$SSH "$TARGET" "( crontab -l 2>/dev/null | grep -v 'sentinel/sentinel.py' ; echo '$LINE' ) | crontab -"
echo "== $TARGET → $NAME: cron installed; first baseline run:"
$SSH "$TARGET" "SENTINEL_ENV=$ENVF python3 ~/.naca/sentinel/sentinel.py --reset --name $NAME"
