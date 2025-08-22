#!/usr/bin/env bash
set -euo pipefail

# Install git hooks from .githooks/ to .git/hooks/

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOKS_SOURCE="${REPO_ROOT}/.githooks"
HOOKS_TARGET="${REPO_ROOT}/.git/hooks"

if [ ! -d "$HOOKS_SOURCE" ]; then
  echo "Error: .githooks directory not found"
  exit 1
fi

if [ ! -d "$HOOKS_TARGET" ]; then
  echo "Error: .git/hooks directory not found. Is this a git repository?"
  exit 1
fi

echo "Installing git hooks..."

# Copy pre-commit hook
if [ -f "${HOOKS_SOURCE}/pre-commit" ]; then
  cp "${HOOKS_SOURCE}/pre-commit" "${HOOKS_TARGET}/pre-commit"
  chmod +x "${HOOKS_TARGET}/pre-commit"
  echo "✓ Installed pre-commit hook"
else
  echo "⚠ No pre-commit hook found in .githooks/"
fi

echo "Git hooks installation complete!"
echo "The pre-commit hook will run automatically before each commit."
echo "To bypass (use with caution): git commit --no-verify"