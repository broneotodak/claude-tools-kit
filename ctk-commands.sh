#!/bin/bash

# CTK Commands - Central command system for Claude Tools Kit
# Usage: ./ctk-commands.sh <command> [args]

CTK_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS_DIR="$CTK_DIR/tools"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Display help
show_help() {
    echo -e "${BLUE}Claude Tools Kit (CTK) Commands${NC}"
    echo ""
    echo "Usage: ./ctk-commands.sh <command> [args]"
    echo ""
    echo -e "${GREEN}Memory Commands:${NC}"
    echo "  save <category> <title> <content> [importance]  - Save a memory"
    echo "  check-recent [count]                           - Show recent memories"
    echo "  check-health                                   - Check memory system health"
    echo "  enrich                                         - Run memory enrichment"
    echo ""
    echo -e "${GREEN}Search Commands:${NC}"
    echo "  search <query>                                 - RAG semantic search"
    echo "  find-memory <keyword>                          - Simple memory search"
    echo ""
    echo -e "${GREEN}Project Commands:${NC}"
    echo "  switch <project>                               - Switch project context"
    echo "  current-project                                - Show current project"
    echo "  list-projects                                  - List all projects"
    echo ""
    echo -e "${GREEN}System Commands:${NC}"
    echo "  verify                                         - Verify CTK setup"
    echo "  status                                         - Show system status"
    echo "  setup-machine                                  - Setup CTK on new machine"
    echo "  install-hooks                                  - Install git hooks"
    echo ""
    echo -e "${GREEN}FlowState Commands:${NC}"
    echo "  flowstate-status                               - Check FlowState integration"
    echo "  sync-activities                                - Sync activities to FlowState"
    echo ""
    echo "Examples:"
    echo "  ./ctk-commands.sh save 'Bug Fix' 'Fixed memory issue' 'Updated enrichment logic' 5"
    echo "  ./ctk-commands.sh search 'memory enrichment'"
    echo "  ./ctk-commands.sh switch flowstate-ai"
}

# Execute command
case "$1" in
    # Memory commands
    "save")
        shift
        node "$TOOLS_DIR/save-memory.js" "$@"
        ;;
    
    "check-recent")
        count="${2:-10}"
        echo -e "${BLUE}Recent memories (last $count):${NC}"
        node "$TOOLS_DIR/check-latest-activities.js" | head -n "$count"
        ;;
    
    "check-health")
        node "$TOOLS_DIR/check-memory-health.js"
        ;;
    
    "enrich")
        echo -e "${BLUE}Running memory enrichment...${NC}"
        node "$TOOLS_DIR/enrich-memories-for-flowstate.js"
        ;;
    
    # Search commands
    "search")
        shift
        if [ -z "$1" ]; then
            echo -e "${RED}Error: Please provide a search query${NC}"
            exit 1
        fi
        node "$TOOLS_DIR/rag-semantic-search.js" "$@"
        ;;
    
    "find-memory")
        shift
        if [ -z "$1" ]; then
            echo -e "${RED}Error: Please provide a keyword${NC}"
            exit 1
        fi
        # Simple grep through recent memories
        node "$TOOLS_DIR/check-latest-activities.js" | grep -i "$1"
        ;;
    
    # Project commands
    "switch")
        project="$2"
        if [ -z "$project" ]; then
            echo -e "${RED}Error: Please provide a project name${NC}"
            exit 1
        fi
        echo -e "${BLUE}Switching to project: $project${NC}"
        # Save context switch to memory
        node "$TOOLS_DIR/save-memory.js" "Context Switch" "Switched to $project" "User switched project context to $project" 6
        echo "export CURRENT_PROJECT=$project" > "$HOME/.ctk_context"
        echo -e "${GREEN}✓ Switched to $project${NC}"
        ;;
    
    "current-project")
        if [ -f "$HOME/.ctk_context" ]; then
            source "$HOME/.ctk_context"
            echo -e "${BLUE}Current project: ${GREEN}$CURRENT_PROJECT${NC}"
        else
            echo -e "${YELLOW}No project context set${NC}"
        fi
        ;;
    
    "list-projects")
        echo -e "${BLUE}Available projects:${NC}"
        ls -d "$HOME/Projects"/*/ 2>/dev/null | xargs -n 1 basename | sort
        ;;
    
    # System commands
    "verify")
        if [ -f "$CTK_DIR/verify-setup.sh" ]; then
            "$CTK_DIR/verify-setup.sh"
        else
            echo -e "${YELLOW}Verify script not found${NC}"
        fi
        ;;
    
    "status")
        echo -e "${BLUE}CTK System Status${NC}"
        echo ""
        echo -e "${GREEN}Environment:${NC}"
        echo "  CTK Directory: $CTK_DIR"
        echo "  Machine: $(hostname)"
        echo "  Platform: $(uname -s)"
        echo ""
        echo -e "${GREEN}Memory System:${NC}"
        node -e "
        require('dotenv').config();
        console.log('  Supabase URL:', process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing');
        console.log('  Service Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Configured' : '✗ Missing');
        "
        echo ""
        echo -e "${GREEN}Automation:${NC}"
        if crontab -l 2>/dev/null | grep -q "enrich-memories"; then
            echo "  Memory Enrichment: ✓ Active (runs every 5 min)"
        else
            echo "  Memory Enrichment: ✗ Not scheduled"
        fi
        if [ -f "$CTK_DIR/.git/hooks/post-commit" ]; then
            echo "  Git Hooks: ✓ Installed"
        else
            echo "  Git Hooks: ✗ Not installed"
        fi
        ;;
    
    "setup-machine")
        if [ -f "$TOOLS_DIR/setup-new-machine.sh" ]; then
            "$TOOLS_DIR/setup-new-machine.sh"
        else
            echo -e "${RED}Setup script not found${NC}"
        fi
        ;;
    
    "install-hooks")
        if [ -f "$TOOLS_DIR/install-working-git-hooks.sh" ]; then
            "$TOOLS_DIR/install-working-git-hooks.sh"
        else
            echo -e "${RED}Hook installer not found${NC}"
        fi
        ;;
    
    # FlowState commands
    "flowstate-status")
        echo -e "${BLUE}FlowState Integration Status${NC}"
        echo ""
        # Check if enrichment is running
        if crontab -l 2>/dev/null | grep -q "enrich-memories"; then
            echo "✓ Memory enrichment active"
        else
            echo "✗ Memory enrichment not scheduled"
        fi
        # Check recent enriched memories
        enriched_count=$(node -e "
        const { createClient } = require('@supabase/supabase-js');
        require('dotenv').config();
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        supabase.from('claude_desktop_memory')
          .select('id', { count: 'exact' })
          .not('metadata->>flowstate_processed', 'is', null)
          .then(({ count }) => console.log(count || 0));
        " 2>/dev/null)
        echo "✓ Enriched memories: $enriched_count"
        ;;
    
    "sync-activities")
        echo -e "${BLUE}Syncing activities to FlowState...${NC}"
        node "$TOOLS_DIR/enrich-memories-for-flowstate.js"
        ;;
    
    # Help and default
    "help"|"-h"|"--help"|"")
        show_help
        ;;
    
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac