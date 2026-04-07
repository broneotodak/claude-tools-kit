#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkSources() {
    try {
        // Get distinct sources from existing records
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .select('source')
            .not('source', 'is', null)
            .limit(10);

        if (error) {
            console.error('Error:', error);
            return;
        }

        console.log('Sample sources from existing records:');
        const uniqueSources = [...new Set(data.map(d => d.source))];
        uniqueSources.forEach(source => console.log(`  - ${source}`));
    } catch (err) {
        console.error('Failed:', err);
    }
}

checkSources();