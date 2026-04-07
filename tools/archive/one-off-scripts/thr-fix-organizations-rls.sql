-- ========================================
-- THR Organizations RLS Fix Script
-- ========================================
-- This script diagnoses and fixes Row Level Security (RLS) issues
-- for the thr_organizations table that's causing 406 errors
-- 
-- Error: GET .../thr_organizations?select=name&organization_id=eq.xxx 406 (Not Acceptable)
-- This error typically means RLS is enabled but no policies allow the operation
--
-- Created: 2025-07-24
-- ========================================

-- Step 1: Check current RLS status
-- ========================================
SELECT 
    schemaname,
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables 
WHERE tablename = 'thr_organizations';

-- Step 2: Check existing policies
-- ========================================
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
WHERE tablename = 'thr_organizations';

-- Step 3: Backup current data (safety first!)
-- ========================================
CREATE TABLE IF NOT EXISTS thr_organizations_backup_20250724 AS 
SELECT * FROM thr_organizations;

-- Step 4: Check table structure to understand what we're working with
-- ========================================
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'thr_organizations'
ORDER BY ordinal_position;

-- Step 5: Disable RLS temporarily to check if that's the issue
-- ========================================
-- IMPORTANT: Only run this in development/testing!
-- ALTER TABLE thr_organizations DISABLE ROW LEVEL SECURITY;

-- Step 6: Create proper RLS policies
-- ========================================

-- First, ensure RLS is enabled
ALTER TABLE thr_organizations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (to start fresh)
DROP POLICY IF EXISTS "Enable read access for all users" ON thr_organizations;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON thr_organizations;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON thr_organizations;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON thr_organizations;
DROP POLICY IF EXISTS "Service role bypass" ON thr_organizations;

-- Create a policy that allows everyone to read organizations (common for reference data)
CREATE POLICY "Enable read access for all users" 
ON thr_organizations 
FOR SELECT 
USING (true);

-- Create a policy for authenticated users to insert (if needed)
CREATE POLICY "Enable insert for authenticated users only" 
ON thr_organizations 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Create a policy for authenticated users to update (if needed)
CREATE POLICY "Enable update for authenticated users only" 
ON thr_organizations 
FOR UPDATE 
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Create a policy for authenticated users to delete (if needed)
CREATE POLICY "Enable delete for authenticated users only" 
ON thr_organizations 
FOR DELETE 
USING (auth.role() = 'authenticated');

-- Create a bypass policy for service role (important for backend operations)
CREATE POLICY "Service role bypass" 
ON thr_organizations 
USING (auth.jwt()->>'role' = 'service_role');

-- Step 7: If you want to allow anonymous access (for public API)
-- ========================================
-- This is useful if your frontend uses anon key
CREATE POLICY "Enable anon read access" 
ON thr_organizations 
FOR SELECT 
TO anon
USING (true);

-- Step 8: Verify the policies are created
-- ========================================
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
WHERE tablename = 'thr_organizations'
ORDER BY policyname;

-- Step 9: Test the access
-- ========================================
-- Run this as different roles to test
SET ROLE anon;
SELECT * FROM thr_organizations LIMIT 5;
RESET ROLE;

SET ROLE authenticated;
SELECT * FROM thr_organizations LIMIT 5;
RESET ROLE;

-- Step 10: Alternative - Completely open access (NOT recommended for production)
-- ========================================
-- If you just want to get it working quickly in development:
/*
ALTER TABLE thr_organizations DISABLE ROW LEVEL SECURITY;

-- OR create a completely permissive policy:
DROP POLICY IF EXISTS "Allow all operations" ON thr_organizations;
CREATE POLICY "Allow all operations" 
ON thr_organizations 
FOR ALL 
USING (true) 
WITH CHECK (true);
*/

-- Step 11: Check if there are any specific column issues
-- ========================================
-- The error mentions selecting 'name' field specifically
SELECT 
    attname AS column_name,
    attnotnull AS not_null,
    pg_get_expr(adbin, adrelid) AS default_value
FROM pg_attribute 
JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
LEFT JOIN pg_attrdef ON pg_attrdef.adrelid = pg_attribute.attrelid 
    AND pg_attrdef.adnum = pg_attribute.attnum
WHERE pg_class.relname = 'thr_organizations' 
    AND pg_attribute.attnum > 0 
    AND NOT pg_attribute.attisdropped
    AND pg_attribute.attname IN ('name', 'organization_id');

-- Step 12: Grant necessary permissions (if using custom roles)
-- ========================================
GRANT SELECT ON thr_organizations TO anon;
GRANT SELECT ON thr_organizations TO authenticated;
GRANT ALL ON thr_organizations TO service_role;

-- ========================================
-- Troubleshooting Notes:
-- ========================================
-- 1. If you still get 406 errors after running this:
--    - Check your Supabase client is using the correct anon/service key
--    - Verify the organization_id exists in the table
--    - Check if there are any database functions that might be interfering
--
-- 2. To completely disable RLS for testing (NOT for production):
--    ALTER TABLE thr_organizations DISABLE ROW LEVEL SECURITY;
--
-- 3. To see what role your client is using:
--    SELECT current_user, session_user, auth.role(), auth.uid();
--
-- 4. Common issues:
--    - Using wrong API key (anon vs service_role)
--    - RLS enabled but no policies defined
--    - Policies too restrictive
--    - Missing grants to roles

-- ========================================
-- Quick Fix for Development (if all else fails):
-- ========================================
-- Run this to completely open access temporarily:
/*
BEGIN;
ALTER TABLE thr_organizations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON thr_organizations TO anon, authenticated, service_role;
COMMIT;
*/

-- Remember to re-enable security before going to production!