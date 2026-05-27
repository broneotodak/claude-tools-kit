#!/bin/sh
# push-to-tdcc — pipe this Mac's keychain creds (already dumped to
# /tmp/tasp-creds-share.json by com.todak.tasp-creds-share.plist) to the
# TDCC VPS over SSH. The TDCC authorized_keys entry pins our key to
# /usr/local/bin/tdcc-creds-receiver, so anything we pipe in is read by that
# program only — we cannot run arbitrary commands.
#
# Invoked by com.todak.push-creds-to-tdcc.plist every 60s on this MBP.

set -eu

SRC="${1:-/tmp/tasp-creds-share.json}"
KEY="${HOME}/.ssh/id_ed25519_tdcc_push"
# TDCC public IP. TDCC isn't on Tailscale (unlike TASP), so we go over the
# public internet. The forced-command boundary + the receiver's monotonic
# expiresAt check are the real security boundary.
TARGET="root@5.223.80.244"

if [ ! -s "$SRC" ]; then
  echo "push-to-tdcc: source $SRC missing or empty — skipping" >&2
  exit 0
fi

if [ ! -f "$KEY" ]; then
  echo "push-to-tdcc: ssh key $KEY missing" >&2
  exit 1
fi

exec /usr/bin/ssh \
  -i "$KEY" \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=5 \
  -o ServerAliveCountMax=2 \
  -F /dev/null \
  "$TARGET" < "$SRC"
