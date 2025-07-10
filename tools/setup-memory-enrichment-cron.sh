#!/bin/bash

# Setup automated memory enrichment for FlowState
# Runs every 5 minutes to process new memories

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENRICH_SCRIPT="$SCRIPT_DIR/enrich-memories-for-flowstate.js"

# Create cron job
echo "Setting up automated memory enrichment..."

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "enrich-memories-for-flowstate.js"; then
    echo "✅ Memory enrichment cron job already exists"
else
    # Add new cron job (every 5 minutes)
    (crontab -l 2>/dev/null; echo "*/5 * * * * cd $SCRIPT_DIR && /usr/local/bin/node $ENRICH_SCRIPT >> ~/Library/Logs/flowstate-enrichment.log 2>&1") | crontab -
    echo "✅ Added memory enrichment cron job (runs every 5 minutes)"
fi

echo ""
echo "📊 Memory enrichment automation is now active!"
echo "📝 Logs: ~/Library/Logs/flowstate-enrichment.log"
echo ""
echo "To check cron status: crontab -l"
echo "To remove: crontab -l | grep -v 'enrich-memories-for-flowstate' | crontab -"