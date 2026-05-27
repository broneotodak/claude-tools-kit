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

# Validate it parses and has the expected shape.
if ! /usr/bin/plutil -convert json -o /dev/null - < "$TMP" 2>/dev/null; then
  # plutil may not handle bare JSON; fall back to a python parse.
  if ! /usr/bin/python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['claudeAiOauth']['expiresAt']" "$TMP" 2>/dev/null; then
    rm -f "$TMP"
    echo "share-from-keychain: keychain payload failed JSON shape check" >&2
    exit 2
  fi
fi

mv "$TMP" "$OUT"
