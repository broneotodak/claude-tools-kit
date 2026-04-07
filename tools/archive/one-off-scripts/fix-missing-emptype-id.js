const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function fix() {
  const orgId = '7c154cd5-4773-4f27-a136-e60ab2bfe0a2';
  const permanentTypeId = '00e4fa3e-2403-4d72-921b-eded8522e1e4';

  // Get all employees with employment_type = 'Permanent' but no employment_type_id
  console.log('=== Finding employees with missing employment_type_id ===\n');
  
  const { data: emps, error: fetchErr } = await supabase
    .from('thr_employees')
    .select('id, employee_no, full_name, employment_info')
    .eq('organization_id', orgId)
    .eq('employment_info->>employment_status', 'active')
    .eq('employment_info->>employment_type', 'Permanent');

  if (fetchErr) {
    console.error('Error fetching:', fetchErr.message);
    return;
  }

  // Filter those without employment_type_id
  const missing = emps.filter(e => !e.employment_info?.employment_type_id);
  console.log('Found', missing.length, 'employees with employment_type = Permanent but no employment_type_id');
  
  if (missing.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  console.log('\n--- Will fix these employees ---');
  missing.forEach(e => {
    console.log('  -', e.employee_no, '|', e.full_name);
  });

  // Ask for confirmation
  console.log('\n--- Applying fix... ---\n');

  let fixed = 0;
  for (const emp of missing) {
    const updatedEmploymentInfo = {
      ...emp.employment_info,
      employment_type_id: permanentTypeId
    };

    const { error: updateErr } = await supabase
      .from('thr_employees')
      .update({ employment_info: updatedEmploymentInfo })
      .eq('id', emp.id);

    if (updateErr) {
      console.error('Failed to fix', emp.employee_no, ':', updateErr.message);
    } else {
      console.log('✓ Fixed', emp.employee_no, '-', emp.full_name);
      fixed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log('Fixed:', fixed, '/', missing.length, 'employees');
  console.log('\nNow these employees will correctly match leave entitlements!');
  console.log('Run year-end re-initialization to apply correct entitlements.');
}

fix().catch(console.error);
