#!/usr/bin/env bash
#
# install-pre-push-hook.sh
#
# Bulk-installs the CTK pre-push hook (refuses direct pushes to main/master)
# into every NACA-fleet repo on this machine. Symlink-based — when the canonical
# script under enforcement/git-hooks/pre-push gets updated, every repo picks up
# the new logic on next push.
#
# USAGE:
#   ./scripts/install-pre-push-hook.sh             # install in known NACA repos
#   ./scripts/install-pre-push-hook.sh --repo PATH # install in one specific repo
#
set -euo pipefail

HOOK_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/enforcement/git-hooks/pre-push"
[ -f "$HOOK_SRC" ] || { echo "missing: $HOOK_SRC"; exit 1; }
chmod +x "$HOOK_SRC"

REPOS=(
  ~/Projects/claude-tools-kit
  ~/Projects/presentation
  ~/Projects/naca
  ~/Projects/naca-app
  ~/Projects/siti-v2
  ~/Projects/verifier-agent
  ~/Projects/planner-agent
  ~/Projects/daily-checkup-agent
  ~/Projects/neotodak-command
)

if [ "${1:-}" = "--repo" ] && [ -n "${2:-}" ]; then
  REPOS=("$2")
fi

for repo in "${REPOS[@]}"; do
  repo="${repo/#\~/$HOME}"
  if [ ! -d "$repo/.git" ]; then
    echo "  skip $repo (not a git repo on disk)"
    continue
  fi
  ln -sfn "$HOOK_SRC" "$repo/.git/hooks/pre-push"
  echo "  ✓ $repo/.git/hooks/pre-push → $HOOK_SRC"
done

echo ""
echo "Done. Test from any of those repos:"
echo "  git push origin main  → should be REJECTED locally with the CTK banner."
