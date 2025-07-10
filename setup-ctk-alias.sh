#!/bin/bash

# Setup CTK alias for easy access from anywhere

CTK_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Setting up CTK alias..."

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.bashrc"
else
    SHELL_CONFIG="$HOME/.profile"
fi

# Add alias if not already present
if ! grep -q "alias ctk=" "$SHELL_CONFIG" 2>/dev/null; then
    echo "" >> "$SHELL_CONFIG"
    echo "# Claude Tools Kit alias" >> "$SHELL_CONFIG"
    echo "alias ctk='$CTK_DIR/ctk-commands.sh'" >> "$SHELL_CONFIG"
    echo "✅ Added CTK alias to $SHELL_CONFIG"
    echo ""
    echo "To use immediately, run:"
    echo "  source $SHELL_CONFIG"
    echo ""
    echo "Then you can use CTK from anywhere:"
    echo "  ctk save 'Test' 'Testing CTK' 'It works!' 5"
    echo "  ctk search 'memory'"
    echo "  ctk status"
else
    echo "✅ CTK alias already configured"
fi