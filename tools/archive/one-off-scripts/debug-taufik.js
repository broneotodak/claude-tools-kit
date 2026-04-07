const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';

  console.log('=== EXACT useOrgScope query ===\n');

  // Exact query from useOrgScope.js lines 79-84
  const { data: employee, error: empError } = await supabase
    .from('thr_employees')
    .select('id, access_level, auth_user_id, full_name, organization_id')
    .eq('auth_user_id', authUserId)
    .eq('employment_info->>employment_status', 'active')
    .single();

  console.log('Error:', empError?.message || empError?.code || 'None');
  console.log('Employee:', employee);

  // Also check ALL records with this auth_user_id (without .single())
  console.log('\n=== ALL employees with this auth_user_id ===');
  const { data: allEmps } = await supabase
    .from('thr_employees')
    .select('id, employee_no, full_name, access_level, auth_user_id, employment_info')
    .eq('auth_user_id', authUserId);

  console.log('Total records:', allEmps?.length);
  allEmps?.forEach(e => {
    console.log('  -', e.employee_no, '| Level:', e.access_level, 
      '| Status:', e.employment_info?.employment_status,
      '| auth_user_id:', e.auth_user_id ? 'SET' : 'NULL');
  });

  // Check if TK001 still has auth_user_id
  console.log('\n=== Checking TK001 specifically ===');
  const { data: tk001 } = await supabase
    .from('thr_employees')
    .select('id, employee_no, auth_user_id, employment_info')
    .eq('employee_no', 'TK001')
    .single();

  console.log('TK001 auth_user_id:', tk001?.auth_user_id);
  console.log('TK001 status:', tk001?.employment_info?.employment_status);
})().catch(console.error);
