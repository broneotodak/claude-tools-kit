const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';

  console.log('=== TAUFIK Assignment Details ===\n');

  const { data: assignments } = await supabase
    .from('thr_admin_org_assignments')
    .select('*')
    .or(`admin_user_id.eq.${authUserId},employee_id.eq.${ta007Id}`);

  for (const a of (assignments || [])) {
    // Get org name
    const { data: org } = await supabase
      .from('thr_organizations')
      .select('name')
      .eq('organization_id', a.organization_id)
      .single();

    console.log('--- Assignment ---');
    console.log('  ID:', a.id);
    console.log('  Org:', org?.name || 'Unknown');
    console.log('  admin_user_id:', a.admin_user_id);
    console.log('  employee_id:', a.employee_id);
    console.log('  is_active:', a.is_active);
  }

  console.log('\n--- Query check ---');
  console.log('TA007 ID:', ta007Id);
  console.log('Auth User ID:', authUserId);

  // The exact query from hrOrganizationService
  const { data: testQuery } = await supabase
    .from('thr_admin_org_assignments')
    .select('organization_id')
    .eq('is_active', true)
    .or(`admin_user_id.eq.${authUserId},employee_id.eq.${ta007Id}`);

  console.log('\nQuery result:', testQuery?.length, 'org(s) found');
  console.log('Org IDs:', testQuery?.map(t => t.organization_id));
})().catch(console.error);
