const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';

  console.log('=== Simulating useOrgScope query for TAUFIK ===\n');

  // This is the exact query from useOrgScope.js line 79-84
  const { data: employee, error: empError } = await supabase
    .from('thr_employees')
    .select('id, access_level, auth_user_id, full_name, organization_id')
    .eq('auth_user_id', authUserId)
    .eq('employment_info->>employment_status', 'active')
    .single();

  console.log('Query result:');
  console.log('  Error:', empError?.message || 'None');
  console.log('  Employee:', employee ? 'FOUND' : 'NOT FOUND');

  if (employee) {
    console.log('\n  Details:');
    console.log('    ID:', employee.id);
    console.log('    Name:', employee.full_name);
    console.log('    Employee No:', employee.employee_no);
    console.log('    Access Level:', employee.access_level);
    console.log('    Organization:', employee.organization_id);
  }

  // Also check how many active employees with this auth_user_id
  const { data: allMatches } = await supabase
    .from('thr_employees')
    .select('employee_no, full_name, access_level, auth_user_id')
    .eq('auth_user_id', authUserId)
    .eq('employment_info->>employment_status', 'active');

  console.log('\n\nAll active employees with this auth_user_id:', allMatches?.length);
  allMatches?.forEach(e => {
    console.log('  -', e.employee_no, '| Level:', e.access_level);
  });

  if (allMatches?.length === 1) {
    console.log('\n✓ GOOD: Only 1 active employee found - .single() will work now!');
  } else if (allMatches?.length > 1) {
    console.log('\n❌ PROBLEM: Multiple active employees found - .single() will fail!');
  }
})().catch(console.error);
