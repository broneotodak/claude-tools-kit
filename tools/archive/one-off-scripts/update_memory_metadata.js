#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function updateMemoryMetadata() {
    // Update the most recent memory (ID 1927) with proper metadata format
    const updatedMetadata = {
        tool: "claude_code",  // Updated to claude_code for proper FlowState display
        feature: "git_operations",
        machine: "Windows Home PC",
        project: "FlowState AI",
        actual_source: "claude_desktop",
        environment: "WSL Ubuntu",
        date: "2025-07-07",
        activities: [
            "git_status_check",
            "git_log_review", 
            "stash_management",
            "memory_config_review"
        ]
    };

    try {
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .update({ metadata: updatedMetadata })
            .eq('id', 1927);

        if (error) {
            console.error('Error updating memory:', error);
            return;
        }

        console.log('✅ Memory metadata updated successfully!');
        console.log('Updated metadata:', JSON.stringify(updatedMetadata, null, 2));
    } catch (err) {
        console.error('Failed to update memory:', err);
    }
}

updateMemoryMetadata();