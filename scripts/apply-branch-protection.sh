#!/usr/bin/env bash
#
# apply-branch-protection.sh
#
# CTK enforcement Layer 3a — server-side. Applies branch protection on `main`
# for every NACA-fleet repo so direct `git push origin main` outside a PR is
# REJECTED by GitHub itself.
#
# What this configures (per repo):
#   - require_pull_request_reviews        (PR must exist; reviews not required)
#   - allow_force_pushes = false
#   - allow_deletions = false
#   - enforce_admins = true               (no admin bypass for direct push)
#   - required_status_checks = null       (we don't gate on CI yet)
#   - lock_branch = false
#   - delete_branch_on_merge = true       (repo-level; cleans up merged branches)
#
# Workflow stays identical:
#   git checkout -b feat/X
#   <make changes>
#   git push -u origin feat/X
#   gh pr create ...
#   gh pr merge --admin --squash --delete-branch  ← still works under protection
#
# What breaks (intentionally):
#   git push origin main         ← rejected by GitHub
#   git push --force origin main ← rejected
#   git push origin :main        ← rejected (delete)
#
# Idempotent — re-run safely.
#
# USAGE:
#   ./scripts/apply-branch-protection.sh             # dry-run (print intended changes)
#   ./scripts/apply-branch-protection.sh --apply     # actually apply
#   ./scripts/apply-branch-protection.sh --apply --repo <name>  # one repo only
#
set -euo pipefail

APPLY=0
SINGLE=""
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --repo) shift; SINGLE="${1:-}"; shift || true ;;
  esac
done

# Curated list of NACA-fleet repos under broneotodak.
# Add a repo here once it's tier_1 or tier_2 and should not accept direct pushes.
REPOS=(
  claude-tools-kit
  presentation
  naca
  naca-app
  siti-v2
  verifier-agent
  planner-agent
  daily-checkup-agent
  neotodak-command
)

# The exact protection body. `required_status_checks: null` because we don't
# have CI gates yet; `enforce_admins: true` because the whole point is to stop
# even admin (Neo) from direct-pushing by accident.
PROTECTION_BODY='{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismissal_restrictions": {},
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}'

apply_one() {
  local repo="$1"
  echo "─── broneotodak/${repo} ───"

  # 1. Branch protection on main
  if [ "$APPLY" -eq 1 ]; then
    if gh api -X PUT "repos/broneotodak/${repo}/branches/main/protection" \
        -H "Accept: application/vnd.github+json" \
        --input - <<< "$PROTECTION_BODY" >/dev/null 2>&1; then
      echo "  ✓ branch protection applied"
    else
      echo "  ✗ branch protection failed (re-run with -d to see error)"
    fi
  else
    echo "  (dry-run) would PUT /repos/broneotodak/${repo}/branches/main/protection"
  fi

  # 2. Repo-level: delete merged branches automatically (reduces email noise)
  if [ "$APPLY" -eq 1 ]; then
    if gh api -X PATCH "repos/broneotodak/${repo}" \
        -H "Accept: application/vnd.github+json" \
        -f delete_branch_on_merge=true >/dev/null 2>&1; then
      echo "  ✓ delete_branch_on_merge = true"
    else
      echo "  ✗ delete_branch_on_merge patch failed"
    fi
  else
    echo "  (dry-run) would PATCH delete_branch_on_merge=true"
  fi
}

if [ -n "$SINGLE" ]; then
  apply_one "$SINGLE"
else
  for r in "${REPOS[@]}"; do
    apply_one "$r"
  done
fi

echo ""
if [ "$APPLY" -eq 1 ]; then
  echo "Done. Test from any repo with: git push origin main  → should be REJECTED."
else
  echo "Dry-run complete. Re-run with --apply to actually configure GitHub."
fi
