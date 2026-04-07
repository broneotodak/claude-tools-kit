const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function check() {
  // Get ALL Level 8 users and their employment_info
  const { data, error } = await supabase
    .from('thr_employees')
    .select('id, full_name, access_level, auth_user_id, employment_info')
    .eq('access_level', 8);

  console.log('=== All Level 8 Employees ===');
  console.log('Total:', data?.length || 0);
  console.log('');

  data?.forEach(e => {
    const hasAuthId = e.auth_user_id ? true : false;
    const empStatus = e.employment_info?.employment_status;
    console.log(e.full_name);
    console.log('  auth_user_id:', hasAuthId ? 'SET' : 'NULL');
    console.log('  employment_status:', empStatus || 'NOT SET');
    console.log('');
  });

  // Also check which one would be returned by the useOrgScope query
  console.log('=== Simulating useOrgScope query for each ===');
  for (const emp of data || []) {
    if (!emp.auth_user_id) continue;

    const { data: result, error: err } = await supabase
      .from('thr_employees')
      .select('id, access_level, auth_user_id, full_name, organization_id')
      .eq('auth_user_id', emp.auth_user_id)
      .eq('employment_info->>employment_status', 'active')
      .single();

    console.log(emp.full_name + ':');
    if (result) {
      console.log('  Found! Access level:', result.access_level);
    } else {
      console.log('  NOT FOUND - Error:', err?.message);
    }
  }
}

check();
