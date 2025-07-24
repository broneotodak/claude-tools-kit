#!/usr/bin/env node

/**
 * Fix RLS (Row Level Security) issues for thr_organizations table
 * This resolves the 406 Not Acceptable error when querying the table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Create client with service role key for admin operations
const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function diagnoseAndFixRLS() {
    console.log('🔍 THR Organizations RLS Diagnostic & Fix Tool');
    console.log('=' .repeat(60));
    console.log();

    try {
        // Step 1: Test current access
        console.log('📋 Step 1: Testing current access to thr_organizations...');
        const { data: testData, error: testError } = await supabase
            .from('thr_organizations')
            .select('*')
            .limit(1);

        if (testError) {
            console.log('❌ Error accessing table:', testError.message);
            console.log('   This confirms RLS is blocking access');
        } else {
            console.log('✅ Successfully accessed table');
            console.log('   Found', testData?.length || 0, 'organizations');
        }
        console.log();

        // Step 2: Check RLS status
        console.log('🔐 Step 2: Checking RLS status...');
        const { data: rlsStatus, error: rlsError } = await supabase.rpc('raw_sql', {
            query: `
                SELECT 
                    schemaname,
                    tablename,
                    rowsecurity AS rls_enabled
                FROM pg_tables 
                WHERE tablename = 'thr_organizations'
            `
        });

        if (!rlsError && rlsStatus) {
            console.log('RLS Status:', rlsStatus);
        }
        console.log();

        // Step 3: Check existing policies
        console.log('📜 Step 3: Checking existing policies...');
        const { data: policies, error: policyError } = await supabase.rpc('raw_sql', {
            query: `
                SELECT 
                    policyname,
                    permissive,
                    roles,
                    cmd
                FROM pg_policies 
                WHERE tablename = 'thr_organizations'
            `
        });

        if (!policyError && policies) {
            if (policies.length === 0) {
                console.log('❌ No policies found! This is likely the cause of 406 errors');
            } else {
                console.log('Found', policies.length, 'policies:');
                policies.forEach(p => {
                    console.log(`  - ${p.policyname} (${p.cmd})`);
                });
            }
        }
        console.log();

        // Step 4: Apply fix
        console.log('🛠️  Step 4: Applying RLS fix...');
        console.log('Creating permissive policies for thr_organizations...');

        // Create the SQL to fix RLS
        const fixSQL = `
            -- Enable RLS
            ALTER TABLE thr_organizations ENABLE ROW LEVEL SECURITY;

            -- Drop existing policies
            DROP POLICY IF EXISTS "Enable read access for all users" ON thr_organizations;
            DROP POLICY IF EXISTS "Enable anon read access" ON thr_organizations;
            DROP POLICY IF EXISTS "Service role bypass" ON thr_organizations;

            -- Create read policy for everyone
            CREATE POLICY "Enable read access for all users" 
            ON thr_organizations 
            FOR SELECT 
            USING (true);

            -- Create specific anon policy
            CREATE POLICY "Enable anon read access" 
            ON thr_organizations 
            FOR SELECT 
            TO anon
            USING (true);

            -- Create service role bypass
            CREATE POLICY "Service role bypass" 
            ON thr_organizations 
            USING (auth.jwt()->>'role' = 'service_role');

            -- Grant permissions
            GRANT SELECT ON thr_organizations TO anon;
            GRANT SELECT ON thr_organizations TO authenticated;
        `;

        // Execute the fix (Note: This requires a function to execute raw SQL)
        console.log('⚠️  Note: To apply these fixes, run the following SQL in Supabase dashboard:');
        console.log();
        console.log(fixSQL);
        console.log();

        // Step 5: Provide quick fix option
        console.log('🚀 Quick Fix Option (Development Only):');
        console.log('If you need immediate access, run this SQL:');
        console.log();
        console.log('ALTER TABLE thr_organizations DISABLE ROW LEVEL SECURITY;');
        console.log();
        console.log('⚠️  WARNING: This disables all security. Only use in development!');
        console.log();

        // Step 6: Test the specific query that was failing
        console.log('🧪 Step 6: Testing the specific failing query...');
        const testOrgId = '7c154cd5-4773-4f27-a136-e60ab2bfe0a2';
        const { data: specificTest, error: specificError } = await supabase
            .from('thr_organizations')
            .select('name')
            .eq('organization_id', testOrgId)
            .single();

        if (specificError) {
            console.log('❌ Specific query still failing:', specificError.message);
            console.log('   Query: select=name&organization_id=eq.' + testOrgId);
        } else {
            console.log('✅ Specific query successful!');
            console.log('   Organization name:', specificTest?.name);
        }

        // Summary
        console.log();
        console.log('📊 Summary:');
        console.log('- The 406 error is caused by RLS being enabled without proper policies');
        console.log('- To fix: Run the SQL commands above in Supabase SQL Editor');
        console.log('- Alternative: Use service_role key instead of anon key in your app');
        console.log();
        console.log('🔗 Next steps:');
        console.log('1. Go to Supabase Dashboard > SQL Editor');
        console.log('2. Copy and run the SQL fix above');
        console.log('3. Test your application again');

    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
    }
}

// Helper function to show how to use different keys
function showKeyUsage() {
    console.log();
    console.log('🔑 API Key Usage:');
    console.log();
    console.log('// For public/frontend access (respects RLS):');
    console.log('const supabase = createClient(url, ANON_KEY);');
    console.log();
    console.log('// For backend/admin access (bypasses RLS):');
    console.log('const supabase = createClient(url, SERVICE_ROLE_KEY);');
    console.log();
}

// Run the diagnostic
diagnoseAndFixRLS()
    .then(() => {
        showKeyUsage();
        process.exit(0);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });