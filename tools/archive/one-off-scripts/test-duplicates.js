const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function check() {
  // Find auth_user_ids with multiple ACTIVE employee records
  const { data: employees } = await supabase
    .from('thr_employees')
    .select('id, full_name, access_level, auth_user_id, organization_id, employment_info')
    .not('auth_user_id', 'is', null)
    .eq('employment_info->>employment_status', 'active');

  // Group by auth_user_id
  const byAuthId = {};
  employees?.forEach(e => {
    if (!byAuthId[e.auth_user_id]) {
      byAuthId[e.auth_user_id] = [];
    }
    byAuthId[e.auth_user_id].push(e);
  });

  // Find duplicates
  console.log('=== Users with Multiple ACTIVE Employee Records ===\n');
  let hasDuplicates = false;

  Object.entries(byAuthId).forEach(([authId, emps]) => {
    if (emps.length > 1) {
      hasDuplicates = true;
      console.log('auth_user_id:', authId);
      emps.forEach(e => {
        console.log('  -', e.full_name, '| Level:', e.access_level, '| Org:', e.organization_id);
      });
      console.log('');
    }
  });

  if (!hasDuplicates) {
    console.log('No duplicates found - each auth_user_id has exactly one active employee record.');
  }

  // Also check Level 8 specifically
  console.log('\n=== Level 8 Users - Query Test ===\n');
  const level8 = employees?.filter(e => e.access_level === 8);
  for (const emp of level8 || []) {
    const { data: result, error } = await supabase
      .from('thr_employees')
      .select('id, access_level, auth_user_id, full_name, organization_id')
      .eq('auth_user_id', emp.auth_user_id)
      .eq('employment_info->>employment_status', 'active')
      .single();

    if (error) {
      console.log(emp.full_name + ': ERROR -', error.message);
      console.log('  (This would break useOrgScope!)');
    } else {
      console.log(emp.full_name + ': OK');
    }
  }
}

check();
