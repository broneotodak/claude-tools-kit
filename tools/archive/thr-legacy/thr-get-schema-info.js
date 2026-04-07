#!/usr/bin/env node

/**
 * THR Database Schema Information Extractor
 * Gets detailed schema information programmatically
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function getSchemaInfo() {
    console.log('🔍 Extracting THR Database Schema Information\n');
    console.log('=' .repeat(60) + '\n');

    // 1. Get table columns with data types
    console.log('📊 Table: master_hr2000 - Column Details:\n');
    
    const { data: columns, error: colError } = await supabase.rpc('get_table_columns', {
        table_name: 'master_hr2000'
    }).single();

    if (colError) {
        // Try alternative query
        const query = `
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'master_hr2000'
            AND table_schema = 'public'
            ORDER BY ordinal_position;
        `;
        
        console.log('Trying direct SQL query for column information...\n');
        console.log('SQL Query to run in Supabase SQL Editor:');
        console.log('```sql');
        console.log(query);
        console.log('```\n');
    }

    // 2. Get constraints
    console.log('🔐 Constraints Query:\n');
    const constraintsQuery = `
        SELECT
            tc.constraint_name,
            tc.constraint_type,
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'public'
        AND tc.table_name = 'master_hr2000';
    `;
    console.log('```sql');
    console.log(constraintsQuery);
    console.log('```\n');

    // 3. Get indexes
    console.log('📍 Indexes Query:\n');
    const indexesQuery = `
        SELECT
            tablename,
            indexname,
            indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'master_hr2000';
    `;
    console.log('```sql');
    console.log(indexesQuery);
    console.log('```\n');

    // 4. Get RLS policies
    console.log('🔒 RLS Policies Query:\n');
    const rlsQuery = `
        SELECT
            schemaname,
            tablename,
            policyname,
            permissive,
            roles,
            cmd,
            qual,
            with_check
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = 'master_hr2000';
    `;
    console.log('```sql');
    console.log(rlsQuery);
    console.log('```\n');

    // 5. Check RLS status
    console.log('🔓 RLS Status Query:\n');
    const rlsStatusQuery = `
        SELECT
            schemaname,
            tablename,
            rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN ('master_hr2000', 'brands', 'organizations', 'employees');
    `;
    console.log('```sql');
    console.log(rlsStatusQuery);
    console.log('```\n');

    // 6. Get all tables with RLS enabled
    console.log('📋 All Tables with RLS:\n');
    const allRlsQuery = `
        SELECT
            schemaname,
            tablename,
            rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
        AND rowsecurity = true;
    `;
    console.log('```sql');
    console.log(allRlsQuery);
    console.log('```\n');

    // 7. Database functions
    console.log('🔧 Database Functions Query:\n');
    const functionsQuery = `
        SELECT
            n.nspname as schema,
            p.proname as function_name,
            pg_catalog.pg_get_function_result(p.oid) as result_type,
            pg_catalog.pg_get_function_arguments(p.oid) as arguments
        FROM pg_catalog.pg_proc p
        LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        ORDER BY p.proname;
    `;
    console.log('```sql');
    console.log(functionsQuery);
    console.log('```\n');

    // 8. Disable RLS command
    console.log('🔓 To disable RLS on tables (run with caution):\n');
    console.log('```sql');
    console.log('-- Disable RLS on specific tables');
    console.log('ALTER TABLE master_hr2000 DISABLE ROW LEVEL SECURITY;');
    console.log('ALTER TABLE brands DISABLE ROW LEVEL SECURITY;');
    console.log('ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;');
    console.log('ALTER TABLE employees DISABLE ROW LEVEL SECURITY;');
    console.log('```\n');

    console.log('📝 Instructions:');
    console.log('1. Go to your Supabase Dashboard > SQL Editor');
    console.log('2. Run each query above to get the information');
    console.log('3. Share the results and we can proceed with cleanup');
    console.log('\nAlternatively, you can share:');
    console.log('- Screenshots of the Table Editor showing column types');
    console.log('- Screenshots of the Authentication > Policies section');
    console.log('- Database schema diagram if available');
}

// Run
if (require.main === module) {
    getSchemaInfo().catch(console.error);
}

module.exports = { getSchemaInfo };