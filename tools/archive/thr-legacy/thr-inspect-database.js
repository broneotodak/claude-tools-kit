#!/usr/bin/env node

/**
 * THR Database Structure Inspector
 * Inspects the current database schema, constraints, and functions
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function inspectDatabase() {
    console.log('🔍 THR Database Structure Analysis\n');
    console.log('=' .repeat(60) + '\n');

    // 1. List all tables
    console.log('📊 Tables in the database:');
    const { data: tables, error: tablesError } = await supabase
        .from('information_schema.tables')
        .select('table_schema, table_name, table_type')
        .in('table_schema', ['public', 'auth'])
        .order('table_schema', { ascending: true })
        .order('table_name', { ascending: true });

    if (tablesError) {
        console.error('Error fetching tables:', tablesError);
        
        // Try alternative approach
        console.log('\nTrying alternative approach...\n');
        const { data: altTables, error: altError } = await supabase.rpc('get_tables_list');
        
        if (altError) {
            console.log('Alternative approach also failed. Let me check what tables we know exist:\n');
            
            // Check known tables
            const knownTables = ['master_hr2000', 'brands', 'organizations', 'employees'];
            for (const table of knownTables) {
                const { count, error } = await supabase
                    .from(table)
                    .select('*', { count: 'exact', head: true });
                
                if (!error) {
                    console.log(`  ✓ ${table} exists (${count} records)`);
                } else {
                    console.log(`  ✗ ${table} not found or inaccessible`);
                }
            }
        }
    } else if (tables) {
        tables.forEach(table => {
            console.log(`  ${table.table_schema}.${table.table_name} (${table.table_type})`);
        });
    }

    // 2. Inspect master_hr2000 structure
    console.log('\n\n📋 Analyzing master_hr2000 table structure:');
    
    // Get column information using a record
    const { data: sampleRecord, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('*')
        .limit(1)
        .single();

    if (!sampleError && sampleRecord) {
        const columns = Object.keys(sampleRecord);
        console.log(`\nTotal columns: ${columns.length}\n`);
        
        // Group columns by type
        const jsonbColumns = [];
        const emptyColumns = [];
        const textColumns = [];
        const numericColumns = [];
        const dateColumns = [];
        
        // Check a few more records to determine column types and usage
        const { data: samples } = await supabase
            .from('master_hr2000')
            .select('*')
            .limit(10);
        
        columns.forEach(col => {
            const value = sampleRecord[col];
            const allEmpty = samples?.every(row => !row[col] || row[col] === '');
            
            if (allEmpty) {
                emptyColumns.push(col);
            } else if (typeof value === 'object' && value !== null) {
                jsonbColumns.push(col);
            } else if (typeof value === 'number') {
                numericColumns.push(col);
            } else if (value && value.toString().match(/^\d{4}-\d{2}-\d{2}/)) {
                dateColumns.push(col);
            } else {
                textColumns.push(col);
            }
        });
        
        console.log('📌 JSONB Columns:', jsonbColumns.length);
        jsonbColumns.forEach(col => console.log(`  - ${col}`));
        
        console.log('\n📌 Empty/Unused Columns:', emptyColumns.length);
        if (emptyColumns.length > 0) {
            console.log('  First 10:', emptyColumns.slice(0, 10).join(', '));
            if (emptyColumns.length > 10) {
                console.log(`  ... and ${emptyColumns.length - 10} more`);
            }
        }
        
        console.log('\n📌 Text Columns:', textColumns.length);
        console.log('\n📌 Numeric Columns:', numericColumns.length);
        console.log('\n📌 Date Columns:', dateColumns.length);
    }

    // 3. Check for existing JSONB consolidations
    console.log('\n\n🔍 Checking existing JSONB fields:');
    const jsonbFields = [
        'spouse_details',
        'statutory_deductions',
        'fixed_allowances',
        'allowances',
        'demographics',
        'contact_info',
        'bank_info',
        'employment_timeline',
        'tax_info'
    ];

    for (const field of jsonbFields) {
        const { count, error } = await supabase
            .from('master_hr2000')
            .select('*', { count: 'exact', head: true })
            .not(field, 'is', null);
        
        if (!error) {
            console.log(`  ${field}: ${count} records with data`);
        }
    }

    // 4. Check related tables
    console.log('\n\n🔍 Checking for related tables:');
    const relatedTables = [
        'brands',
        'organizations', 
        'employees',
        'employment_history',
        'salary_history',
        'leave_records'
    ];

    for (const table of relatedTables) {
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
        
        if (!error) {
            console.log(`  ✓ ${table}: ${count} records`);
        } else {
            console.log(`  ✗ ${table}: Not found`);
        }
    }

    // 5. Database functions
    console.log('\n\n🔧 Checking for database functions:');
    try {
        // Common function names in HR systems
        const functionTests = [
            'calculate_age',
            'get_employee_details',
            'calculate_tenure',
            'get_organization_hierarchy'
        ];
        
        for (const func of functionTests) {
            try {
                const { data, error } = await supabase.rpc(func, { employee_id: 'test' });
                if (!error) {
                    console.log(`  ✓ ${func} exists`);
                }
            } catch (e) {
                // Function doesn't exist
            }
        }
    } catch (e) {
        console.log('  Could not check for functions');
    }

    console.log('\n' + '=' .repeat(60));
    console.log('\n✅ Analysis complete!\n');
}

// Run inspection
if (require.main === module) {
    inspectDatabase().catch(console.error);
}

module.exports = { inspectDatabase };