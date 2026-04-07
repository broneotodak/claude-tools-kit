#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function saveMemory() {
    const memory = {
        category: 'ClaudeN',
        subcategory: 'Git Operations',
        title: 'FlowState AI Repository Check and Memory System Review',
        content: `Reviewed FlowState AI project status:
- Confirmed repository is fully synced with GitHub
- Latest commit: 9a26cda - "Update README with latest fixes - trigger Netlify deploy"
- Time tracking system already implemented in commit 6627b52
- Checked and cleaned up unnecessary git stash
- Reviewed claude.md memory configuration for PGVector Supabase
- Confirmed SSH key is properly configured and added to GitHub`,
        importance: 4,
        user_id: 'neo_todak',
        metadata: {
            tool: 'claude_code',
            feature: 'git_operations',
            machine: 'Windows Home PC',
            project: 'FlowState AI',
            actual_source: 'claude_code',
            environment: 'WSL Ubuntu',
            date: new Date().toISOString().split('T')[0],
            activities: [
                'git_status_check',
                'git_log_review',
                'stash_management',
                'memory_config_review'
            ]
        }
    };

    try {
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .insert([memory]);

        if (error) {
            console.error('Error saving memory:', error);
            return;
        }

        console.log('✅ Memory saved successfully!');
        console.log('Memory details:', memory);
    } catch (err) {
        console.error('Failed to save memory:', err);
    }
}

saveMemory();