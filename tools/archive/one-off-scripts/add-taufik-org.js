const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';
  const todakAcademyId = '951492dc-a480-4391-85a6-f2738ceff92b';  // TA007's org

  console.log('=== Adding org assignment for TAUFIK (TA007) ===\n');

  // Check if assignment already exists
  const { data: existing } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .or(`admin_user_id.eq.${authUserId},employee_id.eq.${ta007Id}`);

  console.log('Existing assignments:', existing?.length || 0);

  if (existing && existing.length > 0) {
    console.log('Already has assignment(s):');
    existing.forEach(a => console.log('  -', a.organization_id));
    return;
  }

  // Add assignment using employee_id (since that's how new assignments should work)
  const { data: inserted, error } = await supabase
    .from('thr_admin_org_assignments')
    .insert({
      employee_id: ta007Id,
      organization_id: todakAcademyId,
      is_active: true,
      assigned_at: new Date().toISOString(),
      notes: 'Level 7 HR Admin - Todak Academy'
    })
    .select();

  if (error) {
    console.log('Insert error:', error.message);

    // Try with admin_user_id instead
    console.log('\nTrying with admin_user_id...');
    const { data: inserted2, error: error2 } = await supabase
      .from('thr_admin_org_assignments')
      .insert({
        admin_user_id: authUserId,
        organization_id: todakAcademyId,
        is_active: true,
        assigned_at: new Date().toISOString(),
        notes: 'Level 7 HR Admin - Todak Academy'
      })
      .select();

    if (error2) {
      console.log('Still failed:', error2.message);
    } else {
      console.log('✓ Added with admin_user_id:', inserted2?.[0]?.id);
    }
  } else {
    console.log('✓ Added with employee_id:', inserted?.[0]?.id);
  }

  // Verify
  console.log('\n--- Verifying ---');
  const { data: verify } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .or(`admin_user_id.eq.${authUserId},employee_id.eq.${ta007Id}`);

  console.log('Total assignments now:', verify?.length);

  // Test the getAssignedOrganizations logic
  console.log('\n--- Testing hrOrganizationService query ---');
  const { data: assignments } = await supabase
    .from('thr_admin_org_assignments')
    .select('organization_id')
    .eq('is_active', true)
    .or(`admin_user_id.eq.${authUserId},employee_id.eq.${ta007Id}`);

  const orgIds = assignments?.map(a => a.organization_id) || [];
  console.log('Organization IDs found:', orgIds);

  if (orgIds.length > 0) {
    console.log('\n✓ TAUFIK should now be able to access Attendance module!');
    console.log('  Ask him to refresh the page.');
  }
})().catch(console.error);
