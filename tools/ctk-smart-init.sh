#!/bin/bash

# CTK Smart Initialization for Claude Code
# Automatically runs appropriate CTK commands based on context

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo -e "${BLUE}🤖 CTK Smart Initialization${NC}"
echo "=========================="
echo ""

# Step 1: Load environment
if [ -f "$HOME/.env" ]; then
    export $(cat "$HOME/.env" | grep -v '^#' | xargs) 2>/dev/null
    echo -e "${GREEN}✅ Environment loaded${NC}"
else
    echo -e "${YELLOW}⚠️  No .env file found${NC}"
fi

# Step 2: Detect context
CONTEXT_TYPE="general"
PROJECT_NAME=""

# Check if in a git repository
if git rev-parse --git-dir > /dev/null 2>&1; then
    PROJECT_NAME=$(basename $(git rev-parse --show-toplevel))
    CONTEXT_TYPE="project"
    echo -e "${GREEN}✅ Project detected: $PROJECT_NAME${NC}"
fi

# Check current directory
CURRENT_DIR=$(pwd)
if [[ "$CURRENT_DIR" == *"flowstate"* ]]; then
    CONTEXT_TYPE="flowstate"
    PROJECT_NAME="FlowState AI"
elif [[ "$CURRENT_DIR" == *"todak"* ]]; then
    CONTEXT_TYPE="todak"
    PROJECT_NAME="TODAK"
elif [[ "$CURRENT_DIR" == *"claude"* ]]; then
    CONTEXT_TYPE="claude"
    PROJECT_NAME="ClaudeN"
fi

# Step 3: Build appropriate context
echo ""
echo -e "${BLUE}📚 Loading context for: $PROJECT_NAME${NC}"
echo ""

# Always show system status first
echo -e "${YELLOW}System Information:${NC}"
echo "- User: $(whoami)"
echo "- Machine: $(hostname)"
echo "- Directory: $CURRENT_DIR"
echo "- Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Load project-specific memories if in a project
if [ "$CONTEXT_TYPE" != "general" ] && [ ! -z "$PROJECT_NAME" ]; then
    echo -e "${YELLOW}Recent $PROJECT_NAME Memories:${NC}"
    node "$SCRIPT_DIR/rag-retrieve.js" --project "$PROJECT_NAME" --limit 3 --format summary 2>/dev/null || echo "No memories found"
    echo ""
fi

# Load recent high-importance memories
echo -e "${YELLOW}Recent Important Items:${NC}"
node "$SCRIPT_DIR/rag-retrieve.js" --days 3 --limit 3 --format summary 2>/dev/null | grep -E "^[0-9]" || echo "No recent important items"
echo ""

# Step 4: Generate startup prompt
STARTUP_PROMPT="I'm continuing from a previous Claude Code session.

Context loaded via CTK (Claude Tools Kit):
- Project: ${PROJECT_NAME:-General}
- Directory: $CURRENT_DIR
- Machine: $(hostname)

Recent context has been loaded. You can:
- Use 'read memory <query>' to search memories
- Use 'save-memory \"content\"' to save new information
- Use 'ctk status' to see system status

What would you like to work on?"

# Step 5: Save prompt and provide instructions
PROMPT_FILE="/tmp/ctk-prompt-$$.txt"
echo "$STARTUP_PROMPT" > "$PROMPT_FILE"

echo -e "${GREEN}✅ CTK initialization complete!${NC}"
echo ""
echo -e "${BLUE}Quick Commands Available:${NC}"
echo "  read memory         - Browse memories"
echo "  read memory <query> - Search memories"
echo "  save-memory <text>  - Save new memory"
echo "  ctk status          - System status"
echo ""

# Copy to clipboard if possible
if command -v xclip > /dev/null 2>&1; then
    echo "$STARTUP_PROMPT" | xclip -selection clipboard
    echo -e "${GREEN}📋 Startup prompt copied to clipboard!${NC}"
elif command -v pbcopy > /dev/null 2>&1; then
    echo "$STARTUP_PROMPT" | pbcopy
    echo -e "${GREEN}📋 Startup prompt copied to clipboard!${NC}"
else
    echo -e "${YELLOW}📄 Startup prompt saved to: $PROMPT_FILE${NC}"
fi

echo ""
echo -e "${BLUE}🚀 Ready to start Claude Code!${NC}"