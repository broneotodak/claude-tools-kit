const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';

  console.log('=== Final Check for TAUFIK (TA007) ===\n');

  // Check org assignments by employee_id
  console.log('1. Checking assignments by employee_id...');
  const { data: byEmpId } = await supabase
    .from('thr_hr_organization_assignments')
    .select('*, thr_organizations(name)')
    .eq('employee_id', ta007Id);

  console.log('   Found:', byEmpId?.length || 0, 'assignments');
  (byEmpId || []).forEach(a => {
    console.log('   -', a.thr_organizations?.name, '| active:', a.is_active);
  });

  // Check by auth_user_id (some systems use this)
  console.log('\n2. Checking assignments by auth_user_id...');
  const { data: byAuthId } = await supabase
    .from('thr_hr_organization_assignments')
    .select('*, thr_organizations(name)')
    .eq('auth_user_id', authUserId);

  console.log('   Found:', byAuthId?.length || 0, 'assignments');
  (byAuthId || []).forEach(a => {
    console.log('   -', a.thr_organizations?.name, '| employee_id:', a.employee_id?.substring(0,8) + '...');
  });

  // Show all available orgs
  console.log('\n3. Available organizations:');
  const { data: orgs } = await supabase
    .from('thr_organizations')
    .select('organization_id, name')
    .order('name');

  orgs?.forEach(o => {
    console.log('   -', o.organization_id.substring(0,8) + '...', '|', o.name);
  });

  // Check the table structure
  console.log('\n4. Checking thr_hr_organization_assignments table columns...');
  const { data: sample } = await supabase
    .from('thr_hr_organization_assignments')
    .select('*')
    .limit(1);

  if (sample && sample[0]) {
    console.log('   Columns:', Object.keys(sample[0]).join(', '));
  }
})().catch(console.error);
