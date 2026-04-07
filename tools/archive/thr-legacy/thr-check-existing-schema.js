#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkExistingSchema() {
    console.log('🔍 Checking existing THR tables schema...\n');
    
    // Tables to check
    const tables = [
        'thr_leave_types',
        'thr_leave_balances', 
        'thr_leave_requests',
        'thr_claim_types',
        'thr_claims',
        'thr_claim_items',
        'thr_asset_categories',
        'thr_assets',
        'thr_asset_assignments',
        'thr_atlas_assets',
        'thr_atlas_employee_assets'
    ];
    
    const existingTables = [];
    const missingTables = [];
    
    for (const table of tables) {
        try {
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });
            
            if (!error) {
                existingTables.push({ table, count: count || 0 });
                console.log(`✅ ${table} - exists (${count || 0} records)`);
            } else if (error.code === '42P01') {
                missingTables.push(table);
                console.log(`❌ ${table} - does not exist`);
            } else {
                console.log(`⚠️  ${table} - error: ${error.message}`);
            }
        } catch (err) {
            missingTables.push(table);
            console.log(`❌ ${table} - does not exist`);
        }
    }
    
    console.log('\n📊 Summary:');
    console.log(`Existing tables: ${existingTables.length}`);
    console.log(`Missing tables: ${missingTables.length}`);
    
    if (existingTables.length > 0) {
        console.log('\n✅ Existing tables with data:');
        existingTables.forEach(t => {
            if (t.count > 0) {
                console.log(`  - ${t.table}: ${t.count} records`);
            }
        });
    }
    
    if (missingTables.length > 0) {
        console.log('\n❌ Tables to create:');
        missingTables.forEach(t => {
            console.log(`  - ${t}`);
        });
    }
    
    // Check if we need to handle existing empty tables differently
    const emptyTables = existingTables.filter(t => t.count === 0);
    if (emptyTables.length > 0) {
        console.log('\n⚠️  Empty tables (may need data):');
        emptyTables.forEach(t => {
            console.log(`  - ${t.table}`);
        });
    }
}

checkExistingSchema().catch(console.error);