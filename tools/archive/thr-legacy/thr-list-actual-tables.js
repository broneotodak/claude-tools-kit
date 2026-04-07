#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function listActualTables() {
    console.log('🔍 Checking actual table names in database...\n');
    
    // Query the information schema to get all tables
    const { data, error } = await supabase
        .rpc('get_table_list');
    
    if (error) {
        // Try a different approach - test common table patterns
        console.log('Testing table patterns...\n');
        
        const patterns = [
            'thr_employees',
            'thr_leave_balances',
            'thr_claims',
            'thr_assets',
            'thr_employee_assets',
            'leave_balances',
            'claims',
            'assets',
            'employee_assets',
            'atlas_assets',
            'atlas_employee_assets'
        ];
        
        for (const table of patterns) {
            try {
                const { count, error } = await supabase
                    .from(table)
                    .select('*', { count: 'exact', head: true });
                
                if (!error) {
                    console.log(`✅ ${table} - exists (${count || 0} records)`);
                } else if (error.code === 'PGRST204') {
                    console.log(`✅ ${table} - exists (0 records)`);
                } else if (error.code === '42P01') {
                    console.log(`❌ ${table} - does not exist`);
                } else {
                    console.log(`⚠️  ${table} - ${error.message}`);
                }
            } catch (err) {
                console.log(`❌ ${table} - error: ${err.message}`);
            }
        }
    } else {
        console.log('Tables found:', data);
    }
    
    // Also check views
    console.log('\n📊 Checking views...');
    const views = ['thr_employees_view', 'employees_view'];
    
    for (const view of views) {
        try {
            const { count, error } = await supabase
                .from(view)
                .select('*', { count: 'exact', head: true });
            
            if (!error) {
                console.log(`✅ ${view} - exists (${count || 0} records)`);
            }
        } catch (err) {
            console.log(`❌ ${view} - not found`);
        }
    }
}

listActualTables().catch(console.error);