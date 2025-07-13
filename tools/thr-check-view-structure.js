#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkViewStructure() {
    console.log('🔍 Checking thr_employees_view structure...\n');
    
    // Get a sample record
    const { data, error } = await supabase
        .from('thr_employees_view')
        .select('*')
        .eq('email', 'neo@todak.com')
        .single();
    
    if (error) {
        console.error('❌ Error:', error);
        return;
    }
    
    if (data) {
        console.log('✅ Found record for neo@todak.com');
        console.log('\n📋 Available fields:');
        const fields = Object.keys(data).sort();
        fields.forEach(field => {
            const value = data[field];
            const type = value === null ? 'null' : typeof value;
            console.log(`  - ${field}: ${type}`);
        });
        
        console.log('\n🔑 ID fields found:');
        fields.filter(f => f.includes('id')).forEach(field => {
            console.log(`  - ${field}: ${data[field]}`);
        });
        
        console.log('\n📧 Email fields:');
        fields.filter(f => f.includes('email')).forEach(field => {
            console.log(`  - ${field}: ${data[field]}`);
        });
    }
    
    // Check if related tables exist
    console.log('\n🔗 Checking related tables...');
    
    const tables = [
        'thr_leave_balances',
        'thr_claims', 
        'thr_atlas_employee_assets'
    ];
    
    for (const table of tables) {
        try {
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });
            
            if (error) {
                console.log(`  ❌ ${table}: ${error.message}`);
            } else {
                console.log(`  ✅ ${table}: exists (${count || 0} records)`);
            }
        } catch (err) {
            console.log(`  ❌ ${table}: ${err.message}`);
        }
    }
}

checkViewStructure().catch(console.error);