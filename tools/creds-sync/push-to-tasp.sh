#!/bin/sh
# push-to-tasp — pipe the shared creds file to TASP VPS over SSH.
# The TASP authorized_keys entry pins this key to /usr/local/bin/tasp-creds-receiver,
# so anything we pipe in is read by that single program — we cannot run arbitrary
# commands on the VPS, regardless of what we put after `ssh`.
#
# Invoked by com.todak.slave-creds-push-tasp.plist every 60s.

set -eu

SRC="${1:-/tmp/slave-creds-share.json}"
KEY="${HOME}/.ssh/id_ed25519_tasp_creds_push"
# Public IP — TASP has Tailscale SSH enabled which intercepts tailnet→tailnet
# SSH and demands re-auth, so we go over the public internet. The forced
# command on the TASP authorized_keys entry plus the receiver's monotonic
# expiresAt check are the real security boundary; a stolen key can only
# replay equally-fresh-or-older credentials (no-op or rejected).
TARGET="root@5.223.43.54"

if [ ! -s "$SRC" ]; then
  echo "push-to-tasp: source $SRC missing or empty — skipping" >&2
  exit 0
fi

if [ ! -f "$KEY" ]; then
  echo "push-to-tasp: ssh key $KEY missing" >&2
  exit 1
fi

# StrictHostKeyChecking=yes forces verification against known_hosts so a MITM
# can't intercept the push. BatchMode prevents password prompts.
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
