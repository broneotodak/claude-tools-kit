#!/bin/bash

# CTK Commands Setup Script
# Adds automated CTK commands to your shell

echo "🛠️  Setting up CTK Automated Commands"
echo "===================================="
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Make the command script executable
chmod +x "$SCRIPT_DIR/tools/ctk-auto-commands.sh"

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="$HOME/.zshrc"
    SHELL_NAME="zsh"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_RC="$HOME/.bashrc"
    SHELL_NAME="bash"
else
    echo "❌ Unsupported shell. Please add manually."
    exit 1
fi

echo "📝 Detected shell: $SHELL_NAME"
echo "📄 Config file: $SHELL_RC"
echo ""

# Check if already installed
if grep -q "CTK Automated Commands" "$SHELL_RC" 2>/dev/null; then
    echo "✅ CTK commands already installed!"
else
    echo "📝 Adding CTK commands to $SHELL_RC..."
    
    cat >> "$SHELL_RC" << 'EOF'

# CTK Automated Commands
alias ctk="$HOME/claude-tools-kit/tools/ctk-auto-commands.sh"

# Intercept common commands for CTK automation
read() {
    if [ "$1" = "memory" ]; then
        shift
        ctk memory "$@"
    elif [ "$1" = "claude.md" ]; then
        ctk claude.md
    else
        command read "$@"
    fi
}

# Quick aliases
alias read-memory="ctk memory"
alias save-memory="ctk save"
alias claude-rag="ctk start"
alias ctk-status="ctk status"

# Auto-run CTK status on new terminal (optional)
# Uncomment the line below to show CTK status on every new terminal
# ctk status

EOF
    
    echo "✅ CTK commands added!"
fi

# Create a command reference card
cat > "$HOME/.ctk-commands" << 'EOF'
🛠️  CTK Command Reference
========================

Quick Commands:
  read memory              - Show recent memories  
  read memory <query>      - Search memories
  read claude.md           - Read config with context
  save-memory "<content>"  - Save new memory
  claude-rag               - Start with RAG context
  ctk-status               - Show system status

Full CTK Commands:
  ctk memory [query]       - Memory operations
  ctk claude.md            - Configuration
  ctk save <content>       - Save memory
  ctk start                - RAG startup
  ctk status               - System status

Examples:
  read memory webhook      - Find webhook-related memories
  save-memory "Fixed the API timeout issue"
  ctk save "Important decision" --project "CTK" --importance 8

Tips:
  - Commands work in any directory
  - Searches use AI semantic understanding
  - All memories are automatically indexed
EOF

echo ""
echo "📋 Command reference saved to: ~/.ctk-commands"
echo ""
echo "🚀 Setup complete! Run this to activate:"
echo "   source $SHELL_RC"
echo ""
echo "Then try:"
echo "   read memory"
echo "   ctk status"