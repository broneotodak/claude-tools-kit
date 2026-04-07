#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkBackup() {
    // Check if backup table exists
    const { count, error } = await supabase
        .from('master_hr2000_backup_2025_07_12')
        .select('*', { count: 'exact', head: true });
    
    if (error) {
        console.log('Error checking backup:', error);
    } else {
        console.log('Backup table exists with', count, 'records');
    }
    
    // List all tables starting with master_hr2000
    const { data: tables } = await supabase.rpc('get_all_tables');
    console.log('\nTables found:', tables?.filter(t => t.table_name?.includes('master_hr2000')));
}

checkBackup().catch(console.error);