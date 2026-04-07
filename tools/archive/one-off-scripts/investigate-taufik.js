const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  console.log('=== Investigating MOHAMAD TAUFIK RIZAL ===\n');

  // 1. Find in thr_employees
  const { data: emps, error: empErr } = await supabase
    .from('thr_employees')
    .select('id, employee_no, full_name, access_level, organization_id, auth_user_id, employment_info')
    .ilike('full_name', '%TAUFIK%');

  if (empErr) {
    console.log('Employee query error:', empErr.message);
  } else if (!emps || emps.length === 0) {
    console.log('❌ No employee found with name containing TAUFIK');
  } else {
    console.log('Found', emps.length, 'employee(s):');
    emps.forEach(e => {
      console.log('\n--- Employee Record ---');
      console.log('ID:', e.id);
      console.log('Employee No:', e.employee_no);
      console.log('Full Name:', e.full_name);
      console.log('Access Level:', e.access_level);
      console.log('Organization ID:', e.organization_id);
      console.log('Auth User ID:', e.auth_user_id);
      console.log('Employment Status:', e.employment_info?.employment_status);
    });
  }

  // 2. Check auth.users if we found employee
  if (emps && emps.length > 0 && emps[0].auth_user_id) {
    console.log('\n\n=== Checking Auth User ===');
    const { data: authUser } = await supabase.auth.admin.getUserById(emps[0].auth_user_id);
    if (authUser?.user) {
      console.log('Auth User Email:', authUser.user.email);
      console.log('Last Sign In:', authUser.user.last_sign_in_at);
    }
  }

  // 3. Check organization assignments
  if (emps && emps.length > 0) {
    console.log('\n\n=== Organization Assignments ===');
    const { data: assignments } = await supabase
      .from('thr_hr_organization_assignments')
      .select('*, thr_organizations(name)')
      .eq('employee_id', emps[0].id);

    if (!assignments || assignments.length === 0) {
      console.log('❌ No organization assignments found!');
    } else {
      console.log('Found', assignments.length, 'assignment(s):');
      assignments.forEach(a => {
        console.log('  - Org:', a.thr_organizations?.name, '| Active:', a.is_active);
      });
    }
  }

  // 4. Also search by partial name in case of typo
  console.log('\n\n=== Also checking users table ===');
  const { data: users } = await supabase
    .from('thr_employees')
    .select('id, employee_no, full_name, access_level, auth_user_id')
    .eq('access_level', 7);

  console.log('All Level 7 users:');
  (users || []).forEach(u => {
    console.log('  -', u.employee_no, '|', u.full_name, '| auth_user_id:', u.auth_user_id ? 'SET' : 'NULL');
  });
})().catch(console.error);
