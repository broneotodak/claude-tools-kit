#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function introspectTable(tableName) {
    console.log(`\n📊 Table: ${tableName}`);
    console.log('='.repeat(50));
    
    // Get column information
    const { data: columns, error } = await supabase
        .rpc('execute_sql', {
            sql_query: `
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' 
                AND table_name = '${tableName}'
                ORDER BY ordinal_position;
            `
        });
    
    if (error) {
        // If execute_sql doesn't work, try getting data directly
        const { data: sample, error: sampleError } = await supabase
            .from(tableName)
            .select('*')
            .limit(1);
        
        if (!sampleError && sample && sample.length > 0) {
            console.log('Columns (from sample data):');
            Object.keys(sample[0]).forEach(col => {
                const value = sample[0][col];
                const type = value === null ? 'unknown' : 
                           typeof value === 'object' ? 'jsonb' : 
                           typeof value;
                console.log(`  - ${col} (${type})`);
            });
        } else {
            console.error('❌ Could not introspect table:', error?.message || sampleError?.message);
        }
    } else if (columns) {
        console.log('Columns:');
        columns.forEach(col => {
            const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
            const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
            console.log(`  - ${col.column_name} (${col.data_type}) ${nullable}${defaultVal}`);
        });
    }
}

async function listTables() {
    console.log('🗄️  Database Tables\n');
    
    const { data: tables, error } = await supabase
        .rpc('execute_sql', {
            sql_query: `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_type = 'BASE TABLE'
                AND table_name LIKE 'thr_%'
                ORDER BY table_name;
            `
        });
    
    if (error) {
        // Fallback: list known tables
        const knownTables = [
            'thr_employees',
            'thr_organizations', 
            'thr_departments',
            'thr_positions',
            'thr_employee_photos',
            'thr_employee_documents',
            'thr_leave_balances',
            'thr_claims'
        ];
        
        console.log('Known THR tables:');
        knownTables.forEach(table => console.log(`  - ${table}`));
        return knownTables;
    }
    
    if (tables) {
        console.log('THR tables in database:');
        tables.forEach(t => console.log(`  - ${t.table_name}`));
        return tables.map(t => t.table_name);
    }
    
    return [];
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // List all tables
        await listTables();
        console.log('\nUsage: node supabase-introspect.js [table_name]');
        console.log('Example: node supabase-introspect.js thr_employees');
    } else {
        // Introspect specific table
        const tableName = args[0];
        await introspectTable(tableName);
    }
}

main().catch(console.error);