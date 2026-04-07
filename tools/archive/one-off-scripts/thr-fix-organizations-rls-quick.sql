-- ========================================
-- QUICK FIX for thr_organizations 406 Error
-- ========================================
-- Run this SQL directly in Supabase SQL Editor
-- This will fix the "406 Not Acceptable" error
-- ========================================

-- Option 1: RECOMMENDED - Add proper RLS policies
-- ========================================
BEGIN;

-- Enable RLS (if not already enabled)
ALTER TABLE thr_organizations ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to start fresh
DROP POLICY IF EXISTS "Enable read access for all users" ON thr_organizations;
DROP POLICY IF EXISTS "Enable anon read access" ON thr_organizations;
DROP POLICY IF EXISTS "Service role bypass" ON thr_organizations;
DROP POLICY IF EXISTS "Allow all operations" ON thr_organizations;

-- Create a simple policy that allows everyone to read
CREATE POLICY "Enable read access for all users" 
ON thr_organizations 
FOR SELECT 
USING (true);

-- Also specifically allow anon role (used by frontend)
CREATE POLICY "Enable anon read access" 
ON thr_organizations 
FOR SELECT 
TO anon
USING (true);

-- Allow service role to do everything
CREATE POLICY "Service role bypass" 
ON thr_organizations 
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT ON thr_organizations TO anon;
GRANT SELECT ON thr_organizations TO authenticated;
GRANT ALL ON thr_organizations TO service_role;

COMMIT;

-- Verify the fix worked
SELECT 'Testing access...' as status;
SELECT COUNT(*) as organization_count FROM thr_organizations;

-- Show the policies that were created
SELECT 
    policyname,
    cmd,
    roles
FROM pg_policies 
WHERE tablename = 'thr_organizations'
ORDER BY policyname;

-- ========================================
-- Option 2: QUICK & DIRTY (Development only!)
-- ========================================
-- Uncomment and run this if you just need it working NOW:
/*
ALTER TABLE thr_organizations DISABLE ROW LEVEL SECURITY;
*/

-- ========================================
-- Testing the specific query that was failing
-- ========================================
-- This should now work:
SELECT name 
FROM thr_organizations 
WHERE organization_id = '7c154cd5-4773-4f27-a136-e60ab2bfe0a2';

-- ========================================
-- IMPORTANT NOTES:
-- ========================================
-- 1. The 406 error happens when RLS is ON but no policies allow the operation
-- 2. Frontend typically uses 'anon' role, so policies must allow 'anon' access
-- 3. For production, you may want more restrictive policies
-- 4. Always test after applying policies