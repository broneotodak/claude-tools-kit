#!/bin/bash

# CTK Automated Commands System
# Intercepts specific commands and runs CTK workflows automatically

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CTK_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment if exists
if [ -f "$HOME/.env" ]; then
    export $(cat "$HOME/.env" | grep -v '^#' | xargs) 2>/dev/null
fi

# Function to read memory with RAG
read_memory() {
    echo "🧠 CTK Memory System Activated"
    echo "=============================="
    echo ""
    
    # Check memory health first
    echo "📊 Checking memory system health..."
    node "$SCRIPT_DIR/check-memory-health.js"
    echo ""
    
    # Get recent memories
    echo "📚 Recent memories (last 7 days):"
    node "$SCRIPT_DIR/check-latest-activities.js" --days 7 --limit 5
    echo ""
    
    # If user provided a query, search for it
    if [ ! -z "$1" ]; then
        echo "🔍 Searching for: $1"
        echo "=================="
        node "$SCRIPT_DIR/rag-semantic-search.js" --context "$@"
    else
        echo "💡 Tip: Use 'read memory <query>' to search specific topics"
        echo "   Example: read memory webhook error"
    fi
}

# Function to read claude.md with context
read_claude_config() {
    echo "📋 CTK Configuration System"
    echo "==========================="
    echo ""
    
    # First, check which claude.md exists
    if [ -f "$HOME/claude.md" ]; then
        echo "✅ Reading local configuration: ~/claude.md"
        cat "$HOME/claude.md"
    elif [ -f "/mnt/h/Projects/Active/claudecode/claude.md" ]; then
        echo "✅ Reading project configuration: /mnt/h/Projects/Active/claudecode/claude.md"
        cat "/mnt/h/Projects/Active/claudecode/claude.md"
    else
        echo "❌ No claude.md found!"
        echo "   Run setup.sh to create one"
        return 1
    fi
    
    echo ""
    echo "🔄 Building current context..."
    node "$SCRIPT_DIR/rag-context-builder.js" --output
}

# Function to save memory with enhanced tool
save_memory() {
    if [ -z "$1" ]; then
        echo "❌ Usage: save memory <content> [--project name] [--importance N]"
        return 1
    fi
    
    echo "💾 Saving to CTK Memory System..."
    node "$SCRIPT_DIR/save-memory-enhanced.js" "$@"
}

# Function to start Claude with full context
claude_start() {
    echo "🚀 Starting Claude with CTK RAG Context"
    echo "======================================"
    echo ""
    
    # Build context
    "$SCRIPT_DIR/claude-rag-startup.sh"
}

# Function to show CTK status
ctk_status() {
    echo "📊 CTK System Status"
    echo "===================="
    echo ""
    
    echo "🏠 Environment:"
    echo "   User: $(whoami)"
    echo "   Machine: $(hostname)"
    echo "   Directory: $(pwd)"
    echo "   CTK Location: $CTK_DIR"
    echo ""
    
    # Check git project
    if git rev-parse --git-dir > /dev/null 2>&1; then
        echo "📁 Git Project:"
        echo "   Name: $(basename $(git rev-parse --show-toplevel))"
        echo "   Branch: $(git branch --show-current)"
        echo "   Remote: $(git remote get-url origin 2>/dev/null || echo 'No remote')"
    else
        echo "📁 Not in a git repository"
    fi
    echo ""
    
    # Check memory system
    echo "🧠 Memory System:"
    if [ ! -z "$SUPABASE_URL" ]; then
        echo "   ✅ Supabase configured"
    else
        echo "   ❌ Supabase not configured"
    fi
    
    if [ ! -z "$OPENAI_API_KEY" ]; then
        echo "   ✅ OpenAI configured (embeddings ready)"
    else
        echo "   ⚠️  OpenAI not configured (no semantic search)"
    fi
}

# Main command parser
case "$1" in
    "memory")
        shift
        read_memory "$@"
        ;;
    "claude.md"|"config")
        read_claude_config
        ;;
    "save")
        shift
        save_memory "$@"
        ;;
    "start")
        claude_start
        ;;
    "status")
        ctk_status
        ;;
    *)
        echo "🛠️  CTK Automated Commands"
        echo "========================="
        echo ""
        echo "Usage: ctk <command> [options]"
        echo ""
        echo "Commands:"
        echo "  memory [query]     - Read memories, optionally search"
        echo "  claude.md          - Read configuration with context"
        echo "  config             - Alias for claude.md"
        echo "  save <content>     - Save new memory"
        echo "  start              - Start Claude with RAG context"
        echo "  status             - Show CTK system status"
        echo ""
        echo "Examples:"
        echo "  ctk memory                    # Show recent memories"
        echo "  ctk memory webhook error      # Search for webhook errors"
        echo "  ctk save \"Fixed API issue\"    # Save a memory"
        echo "  ctk claude.md                 # Read config with context"
        echo "  ctk start                     # Start Claude with context"
        ;;
esac