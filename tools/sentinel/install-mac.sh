#!/usr/bin/env bash
# install-mac.sh — sentinel on a Mac via launchd (every 10 min), reading the
# brain key from the CTK .env already on the machine. Idempotent.
#   tools/sentinel/install-mac.sh [name] [env-file]
set -euo pipefail
NAME=${1:-sentinel-neo-mbp}
ENVF=${2:-$HOME/Projects/claude-tools-kit/.env}
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$HOME/.naca/sentinel; mkdir -p "$DIR"; chmod 700 "$DIR"
cp "$HERE/sentinel.py" "$DIR/sentinel.py"
PLIST=$HOME/Library/LaunchAgents/com.todak.sentinel.plist
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.todak.sentinel</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string><string>$DIR/sentinel.py</string><string>--name</string><string>$NAME</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>SENTINEL_ENV</key><string>$ENVF</string><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/sentinel.log</string>
  <key>StandardErrorPath</key><string>$DIR/sentinel.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/com.todak.sentinel" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "== launchd job com.todak.sentinel loaded (every 600 s); baseline run:"
SENTINEL_ENV=$ENVF /usr/bin/python3 "$DIR/sentinel.py" --reset --name "$NAME"
