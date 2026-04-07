#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkFlowstateActivities() {
    try {
        // Check recent activities
        const { data, error } = await supabase
            .from('flowstate_activities')
            .select('*')
            .eq('project_name', 'ClaudeN')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error('Error:', error);
            return;
        }

        console.log(`Found ${data.length} ClaudeN activities\n`);
        data.forEach((activity, idx) => {
            console.log(`--- Activity ${idx + 1} ---`);
            console.log('Description:', activity.activity_description);
            console.log('Metadata:', JSON.stringify(activity.metadata, null, 2));
            console.log('Created:', activity.created_at);
            console.log('');
        });
    } catch (err) {
        console.error('Failed:', err);
    }
}

checkFlowstateActivities();