#!/bin/sh
# share-from-keychain — dump the Claude Code keychain entry to a shared tmp file.
# Invoked by com.todak.<host>-creds-share.plist every 60s.
# Writes atomically (tmp + mv) so readers never see a partial file.
# Validates JSON shape before publishing — a missing/corrupt keychain entry
# leaves the previous good file in place.

set -eu

OUT="${1:-/tmp/slave-creds-share.json}"
SERVICE="Claude Code-credentials"
TMP="${OUT}.tmp"

umask 077

# `security ... -w` writes the secret to stdout. Aqua-session ACL allows
# this; over SSH it returns empty (interactive-only entitlement).
if ! /usr/bin/security find-generic-password -s "$SERVICE" -w > "$TMP" 2>/dev/null; then
  rm -f "$TMP"
  echo "share-from-keychain: keychain entry '$SERVICE' not readable" >&2
  exit 1
fi

# Validate JSON parses and has the expected shape. Run the shape assertion
# unconditionally — an earlier draft short-circuited on a `plutil -convert json`
# success, which passes ANY syntactically-valid JSON (e.g. `{}`) and would
# let a corrupt keychain blob through. The downstream receiver also validates,
# but failing locally is cheaper than burning an SSH round-trip.
if ! /usr/bin/python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
o = d['claudeAiOauth']
assert isinstance(o.get('expiresAt'), int)
assert o.get('accessToken') and o.get('refreshToken')
assert isinstance(o.get('scopes'), list) and o['scopes']
" "$TMP" 2>/dev/null; then
  rm -f "$TMP"
  echo "share-from-keychain: keychain payload failed JSON shape check" >&2
  exit 2
fi

mv "$TMP" "$OUT"
