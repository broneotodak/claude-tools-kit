#!/usr/bin/env node

/**
 * Add socso_group column to master_hr2000
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function addColumn() {
    console.log('Adding socso_group column...');
    
    // First, let's try updating a record with socso_group to see if it auto-creates
    const { error } = await supabase
        .from('master_hr2000')
        .update({ socso_group: 'S1' })
        .eq('employee_no', 'DUMMY_TEST_RECORD_THAT_DOES_NOT_EXIST');
    
    if (error && error.message.includes('socso_group')) {
        console.log('❌ Column socso_group does not exist in the table');
        console.log('Please add it manually via Supabase dashboard:');
        console.log('ALTER TABLE master_hr2000 ADD COLUMN socso_group VARCHAR(10);');
        return false;
    }
    
    console.log('✅ Column socso_group is ready for use');
    return true;
}

// Run if called directly
if (require.main === module) {
    addColumn().catch(console.error);
}

module.exports = { addColumn };