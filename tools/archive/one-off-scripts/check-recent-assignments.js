const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  console.log('=== All Organization Assignments ===\n');

  // Get all assignments
  const { data: all, error } = await supabase
    .from('thr_hr_organization_assignments')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('Total assignments in table:', all?.length || 0);

  if (!all || all.length === 0) {
    console.log('No assignments found!');
    return;
  }

  console.log('\n--- All assignments ---');
  for (const a of all) {
    // Get employee name
    const { data: emp } = await supabase
      .from('thr_employees')
      .select('employee_no, full_name')
      .eq('id', a.employee_id)
      .single();

    // Get org name
    const { data: org } = await supabase
      .from('thr_organizations')
      .select('name')
      .eq('organization_id', a.organization_id)
      .single();

    console.log(
      (emp?.employee_no || 'N/A').padEnd(10),
      '|', (emp?.full_name || 'Unknown').substring(0,25).padEnd(25),
      '|', (org?.name || 'Unknown Org').substring(0,25).padEnd(25),
      '|', a.is_active ? 'ACTIVE' : 'inactive'
    );
  }
})().catch(console.error);
