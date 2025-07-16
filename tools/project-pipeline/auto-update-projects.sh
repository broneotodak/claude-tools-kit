#!/bin/bash

# Automated Project Pipeline
# This script runs the complete pipeline:
# 1. Discover new projects from memory
# 2. Sync to neotodak.com
# 3. Create notifications

echo "🚀 Starting Automated Project Pipeline"
echo "======================================"

# Set up environment
export NODE_PATH="/opt/homebrew/lib/node_modules"
cd "$(dirname "$0")"

# Step 1: Run project discovery from memories
echo -e "\n📡 Step 1: Discovering projects from memories..."
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://uzamamymfzhelvkwpvgt.supabase.co',
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

async function discover() {
    const { data, error } = await supabase.rpc('discover_projects_from_memories');
    if (error) {
        console.error('Discovery failed:', error);
    } else {
        console.log('✅ Discovery completed');
    }
}

discover();
" || echo "⚠️  Discovery step skipped (function may not exist yet)"

# Step 2: Sync projects to neotodak.com
echo -e "\n🔄 Step 2: Syncing projects to neotodak.com..."
node sync-to-neotodak.js

# Step 3: Update FlowState display
echo -e "\n🌊 Step 3: Updating FlowState display..."
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://uzamamymfzhelvkwpvgt.supabase.co',
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

async function notifyFlowState() {
    const memory = {
        user_id: 'neo_todak',
        memory_type: 'system_event',
        category: 'Project Pipeline Update',
        content: 'Automated project sync completed. All projects updated across systems.',
        importance: 7,
        source: 'project_pipeline',
        metadata: {
            event: 'projects_synced',
            timestamp: new Date().toISOString(),
            systems: ['supabase', 'neotodak.com', 'flowstate']
        }
    };
    
    const { error } = await supabase.from('claude_desktop_memory').insert([memory]);
    if (!error) {
        console.log('✅ FlowState notified');
    }
}

notifyFlowState();
"

# Step 4: Create summary
echo -e "\n📊 Step 4: Creating summary..."
node -e "
const { fetchProjects } = require('./sync-to-neotodak');

async function summary() {
    const projects = await fetchProjects();
    console.log('\\n📈 Project Statistics:');
    console.log('- Total Projects:', projects.length);
    console.log('- Active:', projects.filter(p => p.status === 'active').length);
    console.log('- In Development:', projects.filter(p => p.status === 'development').length);
    console.log('- Beta:', projects.filter(p => p.status === 'beta').length);
}

summary();
"

echo -e "\n✨ Pipeline completed!"
echo "======================================"
echo "Next steps:"
echo "1. Check neotodak-ai-labs repo for updates"
echo "2. Run the commit script if changes were made"
echo "3. Visit https://flowstate.todak.io to see the update notification"