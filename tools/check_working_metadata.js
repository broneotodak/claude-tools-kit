#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkWorkingMetadata() {
    try {
        // Get records where machine is not unknown
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .select('id, metadata, content')
            .not('metadata->machine', 'is', null)
            .limit(5)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error:', error);
            return;
        }

        console.log('Records with proper machine metadata:');
        data.forEach((record, idx) => {
            console.log(`\n--- Record ${idx + 1} (ID: ${record.id}) ---`);
            console.log('Content preview:', record.content.substring(0, 100) + '...');
            console.log('Metadata:', JSON.stringify(record.metadata, null, 2));
        });
    } catch (err) {
        console.error('Failed:', err);
    }
}

checkWorkingMetadata();