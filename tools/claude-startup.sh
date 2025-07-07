#!/bin/bash
# Claude Code Enhanced Startup Script
# Ensures full context is always loaded

# Colors for better visibility
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration paths
FULL_CONFIG="/mnt/h/Projects/Active/claudecode/claude.md"
ENV_FILE="/mnt/h/Projects/Active/claudecode/.env"
CTK_DIR="$HOME/claude-tools-kit"
MEMORY_SCRIPT="$CTK_DIR/tools/check-latest-activities.js"

clear
echo -e "${PURPLE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║         🤖 Claude Code - Context Loader v2.0           ║${NC}"
echo -e "${PURPLE}║           Windows Home PC (WSL Ubuntu)                 ║${NC}"
echo -e "${PURPLE}╚════════════════════════════════════════════════════════╝${NC}"
echo

# Check if full configuration exists
if [ -f "$FULL_CONFIG" ]; then
    echo -e "${GREEN}✅ Full configuration found${NC}"
    echo -e "   📍 Location: $FULL_CONFIG"
else
    echo -e "${YELLOW}⚠️  Full configuration not found!${NC}"
    echo -e "   Expected at: $FULL_CONFIG"
fi

# Check environment file
if [ -f "$ENV_FILE" ]; then
    echo -e "${GREEN}✅ Environment file found${NC}"
    # Load environment variables
    export $(cat "$ENV_FILE" | grep -v '^#' | xargs) 2>/dev/null
else
    echo -e "${YELLOW}⚠️  Environment file not found!${NC}"
    echo -e "   Expected at: $ENV_FILE"
fi

echo
echo -e "${BLUE}📊 System Information:${NC}"
echo "   👤 User: $(whoami)"
echo "   📂 Current directory: $(pwd)"
echo "   🕐 Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "   🔧 Node.js: $(node -v 2>/dev/null || echo 'Not installed')"

# Check recent memories if environment is loaded
if [ ! -z "$SUPABASE_URL" ] && [ -f "$MEMORY_SCRIPT" ]; then
    echo
    echo -e "${BLUE}📝 Checking recent memories...${NC}"
    cd "$CTK_DIR" && node "$MEMORY_SCRIPT" 2>/dev/null | head -10 || echo "   Could not load recent memories"
fi

echo
echo -e "${YELLOW}🚀 Quick Start Commands:${NC}"
echo "   claude-full    - Start Claude with full context"
echo "   claude-memory  - Save a new memory"
echo "   claude-check   - Check recent activities"
echo "   cd-projects    - Go to projects directory"

echo
echo -e "${PURPLE}💡 Recommended: Use 'claude-full' to start with complete context${NC}"
echo

# Create the actual command that will be used
cat > /tmp/claude-context.txt << 'EOF'
I'm continuing from a previous Claude Code session on Windows Home PC (WSL Ubuntu). 

Please:
1. Read the full configuration at: /mnt/h/Projects/Active/claudecode/claude.md
2. Note that .env is already loaded from: /mnt/h/Projects/Active/claudecode/.env
3. Check recent memories in claude_desktop_memory for context
4. I'm neo_todak, working from Windows Home PC

Ready to continue our work!
EOF

echo -e "${GREEN}✨ Context prepared! You can now start Claude Code.${NC}"
echo