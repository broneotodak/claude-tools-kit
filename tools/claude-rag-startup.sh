#!/bin/bash

# Claude Code RAG-Enhanced Startup Script
# Automatically loads relevant context using RAG

echo "🤖 Claude Code RAG Startup"
echo "=========================="
echo ""

# Load environment if exists
if [ -f "$HOME/.env" ]; then
    export $(cat "$HOME/.env" | grep -v '^#' | xargs)
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Build context
echo "📚 Building context from memories..."
node "$SCRIPT_DIR/rag-context-builder.js" > /dev/null 2>&1

# Check if in a git project
GIT_PROJECT=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_PROJECT=$(basename `git rev-parse --show-toplevel`)
    echo "📁 Detected project: $GIT_PROJECT"
fi

# Create startup prompt
STARTUP_PROMPT="I'm continuing from a previous Claude Code session on Windows Home PC (WSL Ubuntu).

## Context Loaded
"

# Add RAG context if available
if [ -f "$HOME/.claude-context" ]; then
    CONTEXT_SIZE=$(wc -c < "$HOME/.claude-context")
    echo "✅ Loaded context: $CONTEXT_SIZE bytes"
    STARTUP_PROMPT="${STARTUP_PROMPT}
$(cat "$HOME/.claude-context")
"
fi

# Add current directory info
STARTUP_PROMPT="${STARTUP_PROMPT}
## Current Environment
- Directory: $(pwd)
- User: $(whoami)
- Time: $(date '+%Y-%m-%d %H:%M:%S')
"

# Add recent commands hint
STARTUP_PROMPT="${STARTUP_PROMPT}
## Available RAG Commands
- rag-retrieve <query>: Search memories
- rag-semantic-search <query>: AI-powered search  
- check-memory-health: Memory system status
- save-memory-enhanced: Save new memories

What would you like to work on?"

# Save prompt to temp file
TEMP_PROMPT="/tmp/claude-rag-prompt-$$.txt"
echo "$STARTUP_PROMPT" > "$TEMP_PROMPT"

echo ""
echo "💡 Starting Claude Code with RAG context..."
echo "   Use 'cat $TEMP_PROMPT' to see the full prompt"
echo ""

# Copy prompt to clipboard if xclip is available
if command -v xclip > /dev/null 2>&1; then
    echo "$STARTUP_PROMPT" | xclip -selection clipboard
    echo "📋 Context copied to clipboard!"
elif command -v pbcopy > /dev/null 2>&1; then
    echo "$STARTUP_PROMPT" | pbcopy
    echo "📋 Context copied to clipboard!"
fi

echo ""
echo "🚀 Ready! Paste the context into Claude Code."
echo ""

# Optionally start claude directly if command exists
if command -v claude > /dev/null 2>&1; then
    echo "Starting claude..."
    claude
fi