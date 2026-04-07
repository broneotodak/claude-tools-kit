#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkNullOwners() {
    console.log('Checking NULL owners directly...\n');

    const { data: nullUserIds, error: idError } = await supabase
        .from('claude_desktop_memory')
        .select('id')
        .is('user_id', null);

    if (idError) {
        console.error('Error checking user_id:', idError);
    } else {
        console.log(`Records with NULL user_id: ${nullUserIds?.length || 0}`);
    }

    const { data: sample } = await supabase
        .from('claude_desktop_memory')
        .select('id, user_id, metadata')
        .limit(5);

    console.log('\nSample records:');
    console.log(JSON.stringify(sample, null, 2));
}

checkNullOwners();