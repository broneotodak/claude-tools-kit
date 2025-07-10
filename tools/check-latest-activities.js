#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkLatestActivities() {
    try {
        // Check latest activities created by memory_sync
        const { data, error } = await supabase
            .from('flowstate_activities')
            .select('*')
            .filter('metadata->>source', 'eq', 'memory_sync')
            .order('created_at', { ascending: false })
            .limit(3);

        if (error) {
            console.error('Error:', error);
            return;
        }

        console.log(`Found ${data.length} synced activities\n`);
        data.forEach((activity, idx) => {
            console.log(`--- Activity ${idx + 1} ---`);
            console.log('Project:', activity.project_name);
            console.log('Description:', activity.activity_description.substring(0, 60) + '...');
            console.log('Metadata:');
            console.log('  Machine:', activity.metadata?.machine || 'Not set');
            console.log('  Tool:', activity.metadata?.tool || 'Not set');
            console.log('  Source:', activity.metadata?.source);
            console.log('  Environment:', activity.metadata?.environment || 'Not set');
            console.log('Created:', activity.created_at);
            console.log('');
        });
    } catch (err) {
        console.error('Failed:', err);
    }
}

checkLatestActivities();