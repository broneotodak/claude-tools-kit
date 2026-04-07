const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function testQuery() {
  // Test the EXACT query from useOrgScope - for a known superadmin auth_user_id
  const { data: admins } = await supabase
    .from('thr_employees')
    .select('id, full_name, access_level, auth_user_id')
    .eq('access_level', 8)
    .not('auth_user_id', 'is', null)
    .limit(1);

  if (!admins || admins.length === 0) {
    console.log('No superadmin with auth_user_id found');
    return;
  }

  const testAuthId = admins[0].auth_user_id;
  console.log('Testing with auth_user_id:', testAuthId);
  console.log('Employee:', admins[0].full_name);
  console.log('');

  // Test the OLD query (column-based - should fail)
  console.log('=== OLD Query (column-based) ===');
  const { data: oldResult, error: oldError } = await supabase
    .from('thr_employees')
    .select('id, access_level, auth_user_id, full_name, organization_id')
    .eq('auth_user_id', testAuthId)
    .eq('employment_status', 'active')
    .single();

  console.log('Result:', oldResult ? 'Found: ' + oldResult.full_name : 'NULL');
  console.log('Error:', oldError?.message || 'None');
  console.log('');

  // Test the NEW query (JSONB-based - should work)
  console.log('=== NEW Query (JSONB-based) ===');
  const { data: newResult, error: newError } = await supabase
    .from('thr_employees')
    .select('id, access_level, auth_user_id, full_name, organization_id')
    .eq('auth_user_id', testAuthId)
    .eq('employment_info->>employment_status', 'active')
    .single();

  console.log('Result:', newResult ? 'Found: ' + newResult.full_name + ' (Level ' + newResult.access_level + ')' : 'NULL');
  console.log('Error:', newError?.message || 'None');
}

testQuery();
