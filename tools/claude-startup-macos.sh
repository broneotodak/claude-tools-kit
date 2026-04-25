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
if [[ "$CURRENT_DIR" == *"/TODAK"* ]] || [[ "$CURRENT_DIR" == *"/todak-ai"* ]]; then
    PROJECT_NAME="TODAK"; PROJECT_EMOJI="💬"
elif [[ "$CURRENT_DIR" == *"/FlowState"* ]] || [[ "$CURRENT_DIR" == *"/flowstate"* ]]; then
    PROJECT_NAME="FlowState"; PROJECT_EMOJI="🌊"
elif [[ "$CURRENT_DIR" == *"/Firasah"* ]] || [[ "$CURRENT_DIR" == *"/firasah"* ]]; then
    PROJECT_NAME="Firasah"; PROJECT_EMOJI="🔮"
elif [[ "$CURRENT_DIR" == *"/ARS"* ]]; then
    PROJECT_NAME="ARS"; PROJECT_EMOJI="🤖"
elif [[ "$CURRENT_DIR" == *"/THR"* ]]; then
    PROJECT_NAME="THR"; PROJECT_EMOJI="💼"
elif [[ "$CURRENT_DIR" == *"/ATLAS"* ]]; then
    PROJECT_NAME="ATLAS"; PROJECT_EMOJI="📦"
elif [[ "$CURRENT_DIR" == *"/Mastra"* ]]; then
    PROJECT_NAME="Mastra"; PROJECT_EMOJI="🎮"
elif [[ "$CURRENT_DIR" == *"/MLBB"* ]]; then
    PROJECT_NAME="MLBB"; PROJECT_EMOJI="📱"
elif [[ "$CURRENT_DIR" == *"/ClaudeN"* ]] || [[ "$CURRENT_DIR" == *"/clauden"* ]]; then
    PROJECT_NAME="ClaudeN"; PROJECT_EMOJI="💜"
elif [[ "$CURRENT_DIR" == *"/claude-tools-kit"* ]]; then
    PROJECT_NAME="CTK"; PROJECT_EMOJI="🧠"
elif [[ "$CURRENT_DIR" == *"/Academy"* ]] || [[ "$CURRENT_DIR" == *"/academy"* ]]; then
    PROJECT_NAME="Academy"; PROJECT_EMOJI="🎓"
elif [[ "$CURRENT_DIR" == *"/naca"* ]] || [[ "$CURRENT_DIR" == *"/NACA"* ]]; then
    PROJECT_NAME="NACA"; PROJECT_EMOJI="🛰️"
elif [[ "$CURRENT_DIR" == *"/presentation"* ]]; then
    PROJECT_NAME="Presentation"; PROJECT_EMOJI="📊"
elif [[ "$CURRENT_DIR" == *"/AskMyLegal"* ]] || [[ "$CURRENT_DIR" == *"/askmylegal"* ]]; then
    PROJECT_NAME="AskMyLegal"; PROJECT_EMOJI="⚖️"
elif [[ "$CURRENT_DIR" == *"/iammuslim"* ]]; then
    PROJECT_NAME="iammuslim"; PROJECT_EMOJI="🕌"
else
    PROJECT_NAME="General"; PROJECT_EMOJI="📂"
fi

# Live counts from neo-brain (xsunmervpyrplzarebva). Helper times out at 2.5s and stays silent on any failure.
CTK_DIR="/Users/broneotodak/Projects/claude-tools-kit"
NB_STATS=$(node "$CTK_DIR/tools/neo-brain-quick-stats.js" "$PROJECT_NAME" 2>/dev/null | tail -1)
NB_TOTAL="${NB_STATS%%|*}"
NB_PROJECT="${NB_STATS##*|}"

echo -e "${GREEN}📍 Current Directory:${NC} $CURRENT_DIR"
echo -e "${GREEN}🎯 Detected Project:${NC} $PROJECT_EMOJI $PROJECT_NAME"
if [ -n "$NB_PROJECT" ]; then
    echo -e "${GREEN}📊 $PROJECT_NAME memories:${NC} $NB_PROJECT"
elif [ "$PROJECT_NAME" = "General" ] && [ -n "$NB_TOTAL" ]; then
    echo -e "${GREEN}📊 No project filter${NC} (in $CURRENT_DIR)"
else
    echo -e "${YELLOW}📊 neo-brain unreachable${NC} (using auto-memory + SDK on demand)"
fi
echo

if [ -n "$NB_TOTAL" ]; then
    echo -e "${GREEN}💾 neo-brain total:${NC} $NB_TOTAL memories (xsunmervpyrplzarebva)"
else
    echo -e "${GREEN}💾 neo-brain:${NC} use \`@todak/memory\` SDK / \`neo_brain_client.py\`"
fi
echo -e "${GREEN}🔧 MCP Servers:${NC} supabase-main, desktop-commander, filesystem"
echo -e "${GREEN}⚡ Context:${NC} Ready with $PROJECT_NAME project intelligence"
echo
echo -e "${PURPLE}═══════════════════════════════════════════════════════${NC}"