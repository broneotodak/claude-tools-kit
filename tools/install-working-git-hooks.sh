#!/bin/bash

# Install working git hooks that don't rely on environment variables
# These hooks will save to CTK memory system

echo "🔧 Installing FlowState git hooks..."

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CTK_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Create post-commit hook
cat > "$CTK_DIR/.git/hooks/post-commit" << 'EOF'
#!/bin/bash

# FlowState Git Hook - Captures commit activities
# No environment variables needed - uses CTK's save-memory.js with embedded config

# Get commit info
COMMIT_MSG=$(git log -1 --pretty=%B)
COMMIT_HASH=$(git log -1 --pretty=%H)
BRANCH=$(git branch --show-current)
PROJECT=$(basename $(git rev-parse --show-toplevel))

# Get CTK directory (hooks are in .git/hooks, so go up 2 levels)
CTK_DIR=$(cd "$(dirname "$0")/../.." && pwd)

# Save to memory using CTK
if [ -f "$CTK_DIR/tools/save-memory.js" ]; then
    cd "$CTK_DIR"
    node tools/save-memory.js "git_commit" "Git Commit: $PROJECT" "Branch: $BRANCH, Commit: $COMMIT_HASH, Message: $COMMIT_MSG" 5 2>/dev/null || true
fi

exit 0
EOF

# Create post-push hook
cat > "$CTK_DIR/.git/hooks/post-push" << 'EOF'
#!/bin/bash

# FlowState Git Hook - Captures push activities

# Get push info
BRANCH=$(git branch --show-current)
PROJECT=$(basename $(git rev-parse --show-toplevel))
REMOTE=$(git remote get-url origin 2>/dev/null || echo "no-remote")

# Get CTK directory
CTK_DIR=$(cd "$(dirname "$0")/../.." && pwd)

# Save to memory
if [ -f "$CTK_DIR/tools/save-memory.js" ]; then
    cd "$CTK_DIR"
    node tools/save-memory.js "git_push" "Git Push: $PROJECT" "Branch: $BRANCH pushed to $REMOTE" 4 2>/dev/null || true
fi

exit 0
EOF

# Make hooks executable
chmod +x "$CTK_DIR/.git/hooks/post-commit"
chmod +x "$CTK_DIR/.git/hooks/post-push"

echo "✅ Git hooks installed in CTK project"
echo ""
echo "📝 Hooks will capture:"
echo "   - Git commits (post-commit)"
echo "   - Git pushes (post-push)"
echo ""
echo "🧪 Test with: git commit --allow-empty -m 'Test FlowState hook'"