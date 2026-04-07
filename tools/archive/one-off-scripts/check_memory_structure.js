#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkMemoryStructure() {
    try {
        // Get a sample record to see the structure
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .select('*')
            .limit(1);

        if (error) {
            console.error('Error querying table:', error);
            return;
        }

        console.log('Sample record structure:', JSON.stringify(data[0], null, 2));
        console.log('\nAvailable columns:', data[0] ? Object.keys(data[0]) : 'No records found');
    } catch (err) {
        console.error('Failed:', err);
    }
}

checkMemoryStructure();