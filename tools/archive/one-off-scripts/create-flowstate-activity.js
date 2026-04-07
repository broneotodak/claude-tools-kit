#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createFlowstateActivity() {
    const activity = {
        user_id: 'neo_todak',
        project_name: 'FlowState AI',
        activity_type: 'development',
        activity_description: 'Investigating FlowState dashboard display issues - found that metadata is empty in flowstate_activities table',
        metadata: {
            machine: 'Windows Home PC',
            tool: 'claude_code',
            source: 'claude_desktop',
            environment: 'WSL Ubuntu',
            user: 'neo_todak'
        }
    };

    try {
        const { data, error } = await supabase
            .from('flowstate_activities')
            .insert([activity]);

        if (error) {
            console.error('Error creating activity:', error);
            return;
        }

        console.log('✅ FlowState activity created successfully!');
        console.log('Activity:', {
            project: activity.project_name,
            description: activity.activity_description.substring(0, 50) + '...',
            metadata: activity.metadata
        });
    } catch (err) {
        console.error('Failed:', err);
    }
}

createFlowstateActivity();