#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function debugInsert() {
    console.log('🔍 Testing single insert to debug issue...\n');
    
    // Test a simple insert
    const testData = {
        code: 'TEST',
        name: 'Test Leave Type',
        days_per_year: 10
    };
    
    console.log('Inserting:', testData);
    
    const { data, error } = await supabase
        .from('thr_leave_types')
        .insert(testData)
        .select();
    
    if (error) {
        console.error('❌ Error details:');
        console.error('Code:', error.code);
        console.error('Message:', error.message);
        console.error('Details:', error.details);
        console.error('Hint:', error.hint);
        console.error('Full error:', JSON.stringify(error, null, 2));
    } else {
        console.log('✅ Success:', data);
    }
    
    // Check if we can read
    console.log('\n📖 Testing read access...');
    const { data: readData, error: readError } = await supabase
        .from('thr_leave_types')
        .select('*')
        .limit(5);
    
    if (readError) {
        console.error('❌ Read error:', readError);
    } else {
        console.log('✅ Can read, found', readData?.length || 0, 'records');
    }
}

debugInsert().catch(console.error);