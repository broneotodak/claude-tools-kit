#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function saveMemory() {
    const memory = {
        user_id: 'neo_todak',
        memory_type: 'technical_solution',
        category: 'ClaudeN',
        content: `FlowState AI Repository Check and Memory System Review (2025-07-07):

Reviewed FlowState AI project status:
- Confirmed repository is fully synced with GitHub
- Latest commit: 9a26cda - "Update README with latest fixes - trigger Netlify deploy"
- Time tracking system already implemented in commit 6627b52
- Checked and cleaned up unnecessary git stash (contained only line ending changes)
- Reviewed claude.md memory configuration for PGVector Supabase
- Confirmed SSH key is properly configured and added to GitHub
- Site is live at: https://flowstate.neotodak.com

Memory System Instructions Reviewed:
- Use claude_desktop_memory table for Claude Code memories
- Include proper metadata with tool, feature, machine, project fields
- Follow importance levels (3-6 for most entries)
- Check recent memories on new sessions`,
        metadata: {
            tool: 'claude_code',
            feature: 'git_operations',
            machine: 'Windows Home PC',
            project: 'FlowState AI',
            actual_source: 'claude_code',
            environment: 'WSL Ubuntu',
            date: '2025-07-07',
            activities: [
                'git_status_check',
                'git_log_review',
                'stash_management',
                'memory_config_review'
            ]
        },
        importance: 4,
        source: 'claude_desktop'
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
        if (data && data[0]) {
            console.log('Memory ID:', data[0].id);
        }
        console.log('\nMemory summary:', {
            category: memory.category,
            type: memory.memory_type,
            importance: memory.importance,
            project: memory.metadata.project
        });
    } catch (err) {
        console.error('Failed to save memory:', err);
    }
}

saveMemory();