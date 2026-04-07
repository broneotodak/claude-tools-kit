const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';

  console.log('=== Checking thr_admin_org_assignments ===\n');

  // Check if table exists and get structure
  const { data: sample, error: sampleErr } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .limit(5);

  if (sampleErr) {
    console.log('Table error:', sampleErr.message);
    return;
  }

  console.log('Table exists! Rows found:', sample?.length || 0);
  if (sample && sample[0]) {
    console.log('Columns:', Object.keys(sample[0]).join(', '));
  }

  // Check for TAUFIK assignments
  console.log('\n--- Checking for TA007 assignments ---');
  const { data: byEmp } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .eq('employee_id', ta007Id);

  console.log('By employee_id:', byEmp?.length || 0, 'assignments');

  const { data: byAuth } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .eq('auth_user_id', authUserId);

  console.log('By auth_user_id:', byAuth?.length || 0, 'assignments');

  // Show all assignments in table
  console.log('\n--- All assignments in table ---');
  for (const a of (sample || [])) {
    const { data: emp } = await supabase
      .from('thr_employees')
      .select('employee_no, full_name')
      .eq('id', a.employee_id)
      .single();

    const { data: org } = await supabase
      .from('thr_organizations')
      .select('name')
      .eq('organization_id', a.organization_id)
      .single();

    console.log(
      (emp?.employee_no || 'N/A').padEnd(10),
      '|', (emp?.full_name || 'Unknown').substring(0,25).padEnd(25),
      '|', (org?.name || 'Unknown').substring(0,25)
    );
  }
})().catch(console.error);
