#!/bin/bash
# Claude Tools Kit Enhanced Setup
# Fixes automatic context loading in WSL

echo "🚀 Claude Tools Kit - Enhanced Setup"
echo "===================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Paths
CTK_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
FULL_CONFIG="/mnt/h/Projects/Active/claudecode/claude.md"
ENV_FILE="/mnt/h/Projects/Active/claudecode/.env"

# Make scripts executable
chmod +x "$CTK_DIR/tools/claude-startup.sh"
chmod +x "$CTK_DIR/tools/"*.js

echo -e "\n${YELLOW}Step 1: Backing up existing configuration${NC}"
# Backup existing claude.md if it's the simplified version
if [ -f "$HOME/claude.md" ]; then
    if ! grep -q "System Context" "$HOME/claude.md"; then
        mv "$HOME/claude.md" "$HOME/claude.md.simple.backup"
        echo -e "${GREEN}✅ Backed up simplified claude.md${NC}"
    fi
fi

echo -e "\n${YELLOW}Step 2: Creating proper symlinks${NC}"
# Remove old symlink if exists
rm -f "$HOME/claude.md" 2>/dev/null
# Create symlink to full configuration
ln -sf "$FULL_CONFIG" "$HOME/claude.md"
echo -e "${GREEN}✅ Linked to full configuration${NC}"

echo -e "\n${YELLOW}Step 3: Installing dependencies${NC}"
cd "$CTK_DIR"
if [ ! -d "node_modules" ]; then
    npm install @supabase/supabase-js dotenv
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

echo -e "\n${YELLOW}Step 4: Setting up enhanced aliases${NC}"

# Remove old claude alias if exists
sed -i '/^alias claude=/d' ~/.bashrc
sed -i '/^# Claude Code/d' ~/.bashrc

# Add new enhanced aliases
cat >> ~/.bashrc << 'BASHRC_CONTENT'

# Claude Tools Kit - Enhanced Commands
export CTK_DIR="$HOME/claude-tools-kit"
export CLAUDE_CONFIG="/mnt/h/Projects/Active/claudecode/claude.md"
export CLAUDE_ENV="/mnt/h/Projects/Active/claudecode/.env"

# Automatically load environment on new terminal
if [ -f "$CLAUDE_ENV" ]; then
    export $(cat "$CLAUDE_ENV" | grep -v '^#' | xargs) 2>/dev/null
fi

# Main claude command with full context
alias claude-full='claude --chat "$(cat /mnt/h/Projects/Active/claudecode/claude.md | head -15 | tr "\n" " ") Please load the full configuration and check recent memories. What would you like to work on?"'

# Quick memory save
claude-memory() {
    if [ $# -lt 4 ]; then
        echo "Usage: claude-memory <category> <title> <content> <importance>"
        echo "Example: claude-memory 'CTK Development' 'Setup Enhancement' 'Improved startup script' 5"
        return 1
    fi
    cd "$CTK_DIR" && node tools/save-memory.js "$1" "$2" "$3" "$4"
}

# Check recent activities
alias claude-check='cd "$CTK_DIR" && node tools/check-latest-activities.js'

# Go to projects directory
alias cd-projects='cd /mnt/h/Projects/Active'

# Show Claude context
alias claude-context='$CTK_DIR/tools/claude-startup.sh'

# Run startup script on new terminal (optional - comment out if too verbose)
# $CTK_DIR/tools/claude-startup.sh

BASHRC_CONTENT

echo -e "${GREEN}✅ Added enhanced aliases to .bashrc${NC}"

echo -e "\n${YELLOW}Step 5: Creating startup notification${NC}"
# Create a file that signals CTK is properly installed
touch "$HOME/.ctk-installed"
echo "$(date '+%Y-%m-%d %H:%M:%S')" > "$HOME/.ctk-installed"

echo -e "\n${BLUE}🎉 Enhanced Setup Complete!${NC}"
echo
echo "Next steps:"
echo "1. Reload your shell: ${GREEN}source ~/.bashrc${NC}"
echo
echo "2. Test the context loader: ${GREEN}claude-context${NC}"
echo
echo "3. Start Claude with full context: ${GREEN}claude-full${NC}"
echo
echo "Available commands:"
echo "  ${BLUE}claude-full${NC}    - Start Claude Code with complete context"
echo "  ${BLUE}claude-memory${NC}  - Save a new memory to Supabase"
echo "  ${BLUE}claude-check${NC}   - Check recent activities"
echo "  ${BLUE}claude-context${NC} - Show current context status"
echo "  ${BLUE}cd-projects${NC}    - Navigate to projects directory"
echo
echo -e "${YELLOW}💡 Tip: The environment is automatically loaded when you open a new terminal!${NC}"