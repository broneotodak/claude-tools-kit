const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  console.log('=== Finding organization-related tables ===\n');

  // Search for tables with 'organization' or 'assignment' in name
  const { data: tables, error } = await supabase.rpc('get_table_names');

  if (error) {
    // Try a different approach - query a known table
    console.log('RPC not available, checking known tables...\n');

    // Check thr_user_organization_access
    const { data: access1, error: e1 } = await supabase
      .from('thr_user_organization_access')
      .select('*')
      .limit(1);

    if (!e1) {
      console.log('✓ thr_user_organization_access EXISTS');
      if (access1 && access1[0]) {
        console.log('  Columns:', Object.keys(access1[0]).join(', '));
      }
    } else {
      console.log('✗ thr_user_organization_access:', e1.message);
    }

    // Check thr_organization_assignments
    const { data: access2, error: e2 } = await supabase
      .from('thr_organization_assignments')
      .select('*')
      .limit(1);

    if (!e2) {
      console.log('✓ thr_organization_assignments EXISTS');
      if (access2 && access2[0]) {
        console.log('  Columns:', Object.keys(access2[0]).join(', '));
      }
    } else {
      console.log('✗ thr_organization_assignments:', e2.message);
    }

    // Check thr_hr_admin_org_access
    const { data: access3, error: e3 } = await supabase
      .from('thr_hr_admin_org_access')
      .select('*')
      .limit(1);

    if (!e3) {
      console.log('✓ thr_hr_admin_org_access EXISTS');
      if (access3 && access3[0]) {
        console.log('  Columns:', Object.keys(access3[0]).join(', '));
      }
    } else {
      console.log('✗ thr_hr_admin_org_access:', e3.message);
    }
  }
})().catch(console.error);
