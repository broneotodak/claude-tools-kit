#!/bin/bash
# CTK Commands - Simple wrapper script
# Usage: ./ctk-commands.sh [command] [args...]

CTK_DIR="/Users/broneotodak/Projects/claude-tools-kit"

case "$1" in
    "status")
        cd "$CTK_DIR" && node tools/check-memory-health.js
        ;;
    "memory")
        shift  # Remove first argument
        cd "$CTK_DIR" && node tools/rag-semantic-search.js "$@"
        ;;
    "save")
        shift
        cd "$CTK_DIR" && node tools/save-memory.js "$@"
        ;;
    "search")
        shift
        cd "$CTK_DIR" && node tools/rag-retrieve.js "$@"
        ;;
    *)
        echo "CTK Commands Available:"
        echo "  ./ctk-commands.sh status    - Check memory health"
        echo "  ./ctk-commands.sh memory <query>  - Search memories"
        echo "  ./ctk-commands.sh save <args>     - Save new memory"
        echo "  ./ctk-commands.sh search <query>  - Retrieve memories"
        echo ""
        echo "Examples:"
        echo "  ./ctk-commands.sh status"
        echo "  ./ctk-commands.sh memory 'TODAK WhatsApp'"
        echo "  ./ctk-commands.sh memory 'recent FlowState work'"
        ;;
esac