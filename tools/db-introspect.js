#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function getTableStructure(tableName) {
    console.log(`\n📊 Analyzing table: ${tableName}`);
    console.log('='.repeat(60));
    
    // Get sample data to understand structure
    const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);
    
    if (error) {
        console.error(`❌ Error accessing ${tableName}:`, error.message);
        return;
    }
    
    if (!data || data.length === 0) {
        console.log('⚠️  Table is empty');
        return;
    }
    
    const sample = data[0];
    console.log('\n📋 Column Structure:');
    
    const columns = {};
    Object.entries(sample).forEach(([key, value]) => {
        let type = 'unknown';
        let details = '';
        
        if (value === null) {
            type = 'nullable';
        } else if (typeof value === 'string') {
            type = 'text';
            if (value.match(/^\d{4}-\d{2}-\d{2}/)) type = 'timestamp/date';
            if (value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) type = 'uuid';
        } else if (typeof value === 'number') {
            type = Number.isInteger(value) ? 'integer' : 'decimal';
        } else if (typeof value === 'boolean') {
            type = 'boolean';
        } else if (typeof value === 'object') {
            type = 'jsonb';
            details = Object.keys(value).join(', ');
        }
        
        columns[key] = { type, value: value?.toString()?.substring(0, 50), details };
    });
    
    // Display columns grouped by type
    const regularCols = [];
    const jsonbCols = [];
    
    Object.entries(columns).forEach(([name, info]) => {
        if (info.type === 'jsonb') {
            jsonbCols.push({ name, ...info });
        } else {
            regularCols.push({ name, ...info });
        }
    });
    
    if (regularCols.length > 0) {
        console.log('\n🔤 Regular Columns:');
        regularCols.forEach(col => {
            console.log(`  - ${col.name} (${col.type})`);
        });
    }
    
    if (jsonbCols.length > 0) {
        console.log('\n📦 JSONB Columns:');
        jsonbCols.forEach(col => {
            console.log(`  - ${col.name}:`);
            if (col.details) {
                console.log(`    Fields: ${col.details}`);
            }
        });
    }
    
    // Get row count
    const { count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
    
    console.log(`\n📊 Total rows: ${count || 0}`);
}

async function listAllTables() {
    console.log('🗄️  Discovering Tables...\n');
    
    // Try to get a list of known THR tables by checking which ones exist
    const knownPrefixes = ['thr_', 'master_'];
    const discoveredTables = [];
    
    // Common table names to check
    const tablesToCheck = [
        'thr_employees',
        'thr_employees_view',
        'thr_organizations',
        'thr_departments',
        'thr_positions',
        'thr_brands',
        'thr_sections',
        'thr_allowance_types',
        'thr_deduction_types',
        'thr_employee_photos',
        'thr_employee_documents',
        'thr_document_types',
        'thr_leave_types',
        'thr_leave_balances',
        'thr_leave_applications',
        'thr_claims',
        'thr_claim_items',
        'thr_asset_categories',
        'thr_assets',
        'thr_asset_assignments',
        'thr_access_levels',
        'thr_access_capabilities',
        'thr_ai_conversations',
        'thr_ai_saved_views',
        'master_hr2000'
    ];
    
    for (const table of tablesToCheck) {
        const { error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
        
        if (!error) {
            discoveredTables.push(table);
        }
    }
    
    if (discoveredTables.length > 0) {
        console.log('✅ Discovered tables:');
        discoveredTables.sort().forEach(table => {
            console.log(`  - ${table}`);
        });
    } else {
        console.log('❌ No tables discovered');
    }
    
    return discoveredTables;
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        const tables = await listAllTables();
        console.log('\n📌 Usage: node db-introspect.js <table_name>');
        console.log('📌 Example: node db-introspect.js thr_employees');
    } else if (args[0] === '--all') {
        const tables = await listAllTables();
        for (const table of tables) {
            await getTableStructure(table);
        }
    } else {
        await getTableStructure(args[0]);
    }
}

main().catch(console.error);