#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_ANON_KEY
);

async function checkEmployeeColumns() {
    console.log('🔍 Checking thr_employees table structure...\n');
    
    // Get one employee record to see all columns
    const { data, error } = await supabase
        .from('thr_employees')
        .select('*')
        .eq('employee_no', 'TS001')
        .single();
    
    if (error) {
        console.error('❌ Error:', error);
        return;
    }
    
    if (data) {
        console.log('✅ Available columns in thr_employees:');
        const columns = Object.keys(data).sort();
        
        // Group columns by type
        const jsonbColumns = [];
        const regularColumns = [];
        
        columns.forEach(col => {
            const value = data[col];
            if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
                jsonbColumns.push(col);
            } else {
                regularColumns.push(col);
            }
        });
        
        console.log('\n📋 Regular columns:');
        regularColumns.forEach(col => console.log(`  - ${col}`));
        
        console.log('\n📦 JSONB columns:');
        jsonbColumns.forEach(col => {
            console.log(`  - ${col}:`);
            const keys = Object.keys(data[col] || {});
            keys.forEach(key => console.log(`    • ${key}`));
        });
        
        // Check for employment timeline data
        console.log('\n🔍 Looking for employment timeline data...');
        if (data.employment_info) {
            console.log('Found in employment_info:', Object.keys(data.employment_info));
        }
        if (data.join_date) {
            console.log('Found direct join_date column');
        }
        if (data.resign_date) {
            console.log('Found direct resign_date column');
        }
    }
}

checkEmployeeColumns().catch(console.error);