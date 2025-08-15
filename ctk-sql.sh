#!/bin/bash

# CTK SQL Direct Runner
# One-line SQL execution for any project
# Usage: ctk-sql <project> "SQL statement"
# Example: ctk-sql thr "SELECT COUNT(*) FROM thr_employees;"

PROJECT=$1
SQL=$2

if [ -z "$PROJECT" ] || [ -z "$SQL" ]; then
    echo "Usage: ctk-sql <project> \"SQL statement\""
    echo "Projects: thr, atlas, todak-ai, flowstate, general"
    echo "Example: ctk-sql thr \"SELECT * FROM thr_employees LIMIT 5;\""
    exit 1
fi

# Map project to directory
case "$PROJECT" in
    "thr"|"THR")
        PROJECT_DIR="/Users/broneotodak/Projects/THR"
        ;;
    "atlas"|"ATLAS")
        PROJECT_DIR="/Users/broneotodak/Projects/ATLAS"
        ;;
    "todak-ai"|"todak")
        PROJECT_DIR="/Users/broneotodak/Projects/todak-ai"
        ;;
    "flowstate")
        PROJECT_DIR="/Users/broneotodak/Projects/flowstate-ai"
        ;;
    *)
        PROJECT_DIR="/Users/broneotodak/Projects"
        ;;
esac

# Run SQL using the migration tool
echo "🔄 Running SQL in $PROJECT..."
cd "$PROJECT_DIR" 2>/dev/null || cd /Users/broneotodak/Projects

node /Users/broneotodak/Projects/claude-tools-kit/tools/run-sql-migration.js \
    --sql "$SQL" \
    --auto-confirm \
    --skip-dry-run

# Quick alias setup
if ! command -v ctk-sql &> /dev/null; then
    echo ""
    echo "💡 To use 'ctk-sql' from anywhere, add this to your ~/.bashrc or ~/.zshrc:"
    echo "   alias ctk-sql='bash /Users/broneotodak/Projects/claude-tools-kit/ctk-sql.sh'"
fi