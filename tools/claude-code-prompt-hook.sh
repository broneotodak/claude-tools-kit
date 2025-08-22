#!/bin/bash

# Claude Code Prompt Hook
# This hook automatically saves prompts to memory
# Can be integrated with Claude Code's execution flow

PROMPT="$1"
RESPONSE="$2"
IMPORTANCE="${3:-5}"
PROJECT="${4:-$(basename $(pwd))}"

# Get Node.js path
NODE_PATH="/opt/homebrew/bin/node"
if [ ! -f "$NODE_PATH" ]; then
    NODE_PATH="/usr/local/bin/node"
fi
if [ ! -f "$NODE_PATH" ]; then
    NODE_PATH="node"
fi

# Save to memory using universal save
$NODE_PATH /Users/broneotodak/Projects/claude-tools-kit/tools/universal-memory-save.js \
    "Claude Code Prompt: $PROMPT | Response: ${RESPONSE:0:500}" \
    --type="conversation" \
    --category="$PROJECT" \
    --importance="$IMPORTANCE" \
    --metadata='{"tool":"claude_code","feature":"prompt_hook"}'

# Also trigger auto-save if needed
if [ "$IMPORTANCE" -ge 6 ]; then
    $NODE_PATH /Users/broneotodak/Projects/claude-tools-kit/tools/claude-code-auto-save.js save "$PROMPT" "$RESPONSE"
fi

echo "✅ Prompt saved to memory"