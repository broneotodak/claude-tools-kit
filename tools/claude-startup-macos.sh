#!/bin/bash
# CTK MacOS - Project Context Loader
# Detects current project and loads relevant memories

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Get current directory
CURRENT_DIR=$(pwd)
PROJECT_NAME="Unknown"
PROJECT_EMOJI="📁"

echo -e "${PURPLE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║         🤖 CTK - Claude Code Context Loader           ║${NC}"
echo -e "${PURPLE}║              MacBook Pro - macOS                       ║${NC}"
echo -e "${PURPLE}╚════════════════════════════════════════════════════════╝${NC}"
echo

# Project Detection Logic
if [[ "$CURRENT_DIR" == *"/TODAK"* ]]; then
    PROJECT_NAME="TODAK"
    PROJECT_EMOJI="💬"
    MEMORY_COUNT=372
elif [[ "$CURRENT_DIR" == *"/FlowState"* ]] || [[ "$CURRENT_DIR" == *"/flowstate"* ]]; then
    PROJECT_NAME="FlowState"
    PROJECT_EMOJI="🌊"
    MEMORY_COUNT=153
elif [[ "$CURRENT_DIR" == *"/Firasah"* ]] || [[ "$CURRENT_DIR" == *"/firasah"* ]]; then
    PROJECT_NAME="Firasah"
    PROJECT_EMOJI="🔮"
    MEMORY_COUNT=165
elif [[ "$CURRENT_DIR" == *"/ARS"* ]]; then
    PROJECT_NAME="ARS"
    PROJECT_EMOJI="🤖"
    MEMORY_COUNT=36
elif [[ "$CURRENT_DIR" == *"/THR"* ]]; then
    PROJECT_NAME="THR"
    PROJECT_EMOJI="💼"
    MEMORY_COUNT=19
elif [[ "$CURRENT_DIR" == *"/ATLAS"* ]]; then
    PROJECT_NAME="ATLAS"
    PROJECT_EMOJI="📦"
    MEMORY_COUNT=1
elif [[ "$CURRENT_DIR" == *"/Mastra"* ]]; then
    PROJECT_NAME="Mastra"
    PROJECT_EMOJI="🎮"
    MEMORY_COUNT=1
elif [[ "$CURRENT_DIR" == *"/MLBB"* ]]; then
    PROJECT_NAME="MLBB"
    PROJECT_EMOJI="📱"
    MEMORY_COUNT=1
elif [[ "$CURRENT_DIR" == *"/ClaudeN"* ]]; then
    PROJECT_NAME="ClaudeN"
    PROJECT_EMOJI="💜"
    MEMORY_COUNT=5
elif [[ "$CURRENT_DIR" == *"/claude-tools-kit"* ]]; then
    PROJECT_NAME="CTK"
    PROJECT_EMOJI="🧠"
    MEMORY_COUNT=17
else
    PROJECT_NAME="General"
    PROJECT_EMOJI="📂"
    MEMORY_COUNT="Unknown"
fi

echo -e "${GREEN}📍 Current Directory:${NC} $CURRENT_DIR"
echo -e "${GREEN}🎯 Detected Project:${NC} $PROJECT_EMOJI $PROJECT_NAME"
echo -e "${GREEN}📊 Available Memories:${NC} $MEMORY_COUNT memories"
echo

# Load recent project memories (if CTK tools available)
CTK_DIR="/Users/broneotodak/Projects/claude-tools-kit"
if [ -f "$CTK_DIR/tools/rag-semantic-search.js" ] && [ "$PROJECT_NAME" != "Unknown" ] && [ "$PROJECT_NAME" != "General" ]; then
    echo -e "${YELLOW}🧠 Loading recent $PROJECT_NAME memories...${NC}"
    cd "$CTK_DIR" && node tools/rag-semantic-search.js --limit 3 --threshold 0.6 "$PROJECT_NAME" 2>/dev/null | grep -E "(Found|match)" | head -3
    echo
fi

echo -e "${GREEN}🔧 MCP Servers:${NC} supabase-main, desktop-commander, filesystem"
echo -e "${GREEN}💾 Memory Database:${NC} 1,768+ total memories accessible"
echo -e "${GREEN}⚡ Context:${NC} Ready with $PROJECT_NAME project intelligence"
echo
echo -e "${PURPLE}═══════════════════════════════════════════════════════${NC}"