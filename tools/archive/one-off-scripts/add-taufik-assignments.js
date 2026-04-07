const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';

  // TA007 is in Todak Academy (951492dc-a480-4391-85a6-f2738ceff92b)
  // Add that org as assignment
  const todakAcademyId = '951492dc-a480-4391-85a6-f2738ceff92b';

  console.log('=== Adding Todak Academy assignment for TA007 ===\n');

  // Check table structure from existing row
  const { data: existing } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .limit(1);

  console.log('Existing row structure:', existing?.[0]);

  // Add assignment
  const { data: inserted, error } = await supabase
    .from('thr_admin_org_assignments')
    .insert({
      admin_user_id: authUserId,
      employee_id: ta007Id,
      organization_id: todakAcademyId,
      is_active: true,
      notes: 'Added for Level 7 HR Admin access'
    })
    .select();

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('✓ Assignment added successfully!');
  console.log('  ID:', inserted?.[0]?.id);

  // Verify
  const { data: verify } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .eq('employee_id', ta007Id);

  console.log('\nVerification - TAUFIK now has', verify?.length, 'assignment(s)');
})().catch(console.error);
