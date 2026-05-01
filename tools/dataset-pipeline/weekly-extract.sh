#!/bin/bash
# Weekly extraction wrapper — runs extract.js, then weekly-summary.mjs to compute
# a delta vs the previous run and save a memory to neo-brain.
#
# Invoked by ~/Library/LaunchAgents/com.todak.dataset-pipeline.weekly.plist.
# Logs to ~/Library/Logs/dataset-pipeline.log.

set -e

# Resolve paths relative to this script (works from launchd, cron, manual)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/../.." && pwd )"

LOG=~/Library/Logs/dataset-pipeline.log
mkdir -p "$( dirname "$LOG" )"

# Use Homebrew Node if launchd's PATH is bare
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$REPO_DIR"

{
  echo
  echo "=== $( date -u +%Y-%m-%dT%H:%M:%SZ ) — weekly extraction ==="

  # 1. Capture today's date so we can find its manifest after extraction
  TODAY=$( date +%Y-%m-%d )

  # 2. Run extraction (default flags: visibility=internal,private; slice=all)
  node tools/dataset-pipeline/extract.js

  # 3. Compute delta + save memory
  CURR_MANIFEST="$HOME/datasets/neo-corpus/$TODAY/manifest.json"
  if [[ -f "$CURR_MANIFEST" ]]; then
    node tools/dataset-pipeline/weekly-summary.mjs "$CURR_MANIFEST"
  else
    echo "[error] expected manifest not found: $CURR_MANIFEST"
    exit 1
  fi

  echo "=== done ==="
} >> "$LOG" 2>&1
