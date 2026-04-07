const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';  // TA007 - Level 7
  const tk001Id = '03e0f1cf-9d65-4272-9e0f-184c44d5b80a';  // TK001 - Level 0

  console.log('=== Checking org assignments for BOTH records ===\n');

  // Check TA007 assignments
  const { data: ta007Assigns } = await supabase
    .from('thr_hr_organization_assignments')
    .select('*, thr_organizations(name)')
    .eq('employee_id', ta007Id);

  console.log('TA007 (Level 7) assignments:', ta007Assigns?.length || 0);
  (ta007Assigns || []).forEach(a => {
    console.log('  -', a.thr_organizations?.name);
  });

  // Check TK001 assignments
  const { data: tk001Assigns } = await supabase
    .from('thr_hr_organization_assignments')
    .select('*, thr_organizations(name)')
    .eq('employee_id', tk001Id);

  console.log('\nTK001 (Level 0) assignments:', tk001Assigns?.length || 0);
  (tk001Assigns || []).forEach(a => {
    console.log('  -', a.thr_organizations?.name);
  });

  // Check which org these IDs belong to
  console.log('\n=== Organization Details ===');
  const { data: orgs } = await supabase
    .from('thr_organizations')
    .select('organization_id, name')
    .in('organization_id', ['6e0cff12-3d6d-4dc2-8291-52cae49e734b', '951492dc-a480-4391-85a6-f2738ceff92b']);

  orgs?.forEach(o => {
    console.log(o.organization_id, '→', o.name);
  });

  console.log('\n=== ROOT CAUSE ===');
  console.log('Same auth_user_id (8f669a61-a5a7-4759-83e7-5561795d2346) is linked to 2 employee records!');
  console.log('When user logs in, system finds TK001 first (Level 0) instead of TA007 (Level 7)');
  console.log('\n=== FIX OPTIONS ===');
  console.log('1. Remove auth_user_id from TK001 (so only TA007 is linked to login)');
  console.log('2. Delete TK001 if it\'s a duplicate');
})().catch(console.error);
