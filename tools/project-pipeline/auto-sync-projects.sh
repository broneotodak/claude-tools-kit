#!/bin/bash

# Automated Project Sync Pipeline
# Run this via cron or n8n to keep projects synced
# Example cron: */30 * * * * /path/to/auto-sync-projects.sh

echo "🔄 Starting automated project sync at $(date)"
echo "================================================"

# Set up environment
export NODE_PATH="/opt/homebrew/lib/node_modules"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Run the discover and sync script
echo "📡 Discovering projects from memory..."
node discover-and-sync.js

# Check if the TypeScript file was updated
if [ -f "/Users/broneotodak/Projects/neotodak-ai-labs/auto-commit-projects.sh" ]; then
    echo ""
    echo "🚀 Pushing updates to GitHub..."
    cd /Users/broneotodak/Projects/neotodak-ai-labs
    ./auto-commit-projects.sh
    rm -f auto-commit-projects.sh
    echo "✅ GitHub updated successfully"
else
    echo "ℹ️  No updates needed"
fi

# Create a log entry
LOG_FILE="$SCRIPT_DIR/sync.log"
echo "[$(date)] Sync completed" >> "$LOG_FILE"

# Optional: Send notification to FlowState
node -e "
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL || process.env.FLOWSTATE_URL;
const key = process.env.FLOWSTATE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
    console.log('⚠️  FlowState notification skipped - missing credentials');
    process.exit(0);
}

const supabase = createClient(url, key);

supabase.from('claude_desktop_memory').insert([{
    user_id: 'neo_todak',
    memory_type: 'automation_log',
    category: 'Project Sync',
    content: 'Automated project sync completed successfully',
    importance: 5,
    source: 'claude_desktop',
    metadata: {
        event: 'auto_sync_completed',
        timestamp: new Date().toISOString()
    }
}]).then(() => console.log('📝 FlowState notified'));
"

echo ""
echo "✨ Sync pipeline completed at $(date)"
echo "================================================"