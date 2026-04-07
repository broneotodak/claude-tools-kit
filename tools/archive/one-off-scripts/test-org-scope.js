/**
 * Test script to verify useOrgScope query flow for Level 8 users
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(
  process.env.THR_SUPABASE_URL,
  process.env.THR_SERVICE_KEY
);

async function testOrgScope() {
  console.log('=== Testing useOrgScope Query Flow ===\n');

  // Step 1: Find Level 8 users with auth_user_id
  console.log('1. Finding Level 8 employees with auth_user_id...');
  const { data: level8Users, error: level8Error } = await supabase
    .from('thr_employees')
    .select('id, full_name, access_level, auth_user_id, organization_id, employment_info')
    .eq('access_level', 8)
    .not('auth_user_id', 'is', null);

  if (level8Error) {
    console.error('Error finding Level 8 users:', level8Error.message);
    return;
  }

  console.log(`Found ${level8Users?.length || 0} Level 8 users with auth_user_id\n`);

  // For each Level 8 user, simulate useOrgScope query
  for (const user of level8Users || []) {
    console.log(`\n=== Testing: ${user.full_name} ===`);
    console.log(`Auth User ID: ${user.auth_user_id}`);
    console.log(`Employment Status in JSONB: ${user.employment_info?.employment_status || 'NOT SET'}`);

    // Simulate the EXACT query from useOrgScope (line 79-84)
    console.log('\n[Simulating useOrgScope query...]');
    const { data: employee, error: empError } = await supabase
      .from('thr_employees')
      .select('id, access_level, auth_user_id, full_name, organization_id')
      .eq('auth_user_id', user.auth_user_id)
      .eq('employment_info->>employment_status', 'active')
      .single();

    if (empError) {
      console.log(`❌ QUERY FAILED: ${empError.message}`);
      console.log('   This means useOrgScope cannot find this user!');
      console.log('   Possible reasons:');
      console.log('   - employment_info.employment_status is not "active"');
      console.log('   - Multiple active records for this auth_user_id');
    } else {
      console.log(`✅ QUERY SUCCESS: Found ${employee.full_name}`);
      console.log(`   Access Level: ${employee.access_level}`);
      console.log(`   >=8 check: ${employee.access_level >= 8}`);

      if (employee.access_level >= 8) {
        console.log('   → Would set canViewAll: TRUE');

        // Verify orgs would load
        const { data: orgs } = await supabase
          .from('thr_organizations')
          .select('organization_id, name')
          .order('name');
        console.log(`   → Would load ${orgs?.length || 0} organizations`);
      } else {
        console.log('   → Would set canViewAll: FALSE');
      }
    }
  }

  // Also check if there are any Level 8 users without employment_status set
  console.log('\n\n=== Checking employment_status coverage ===');
  const { data: allLevel8, error: allErr } = await supabase
    .from('thr_employees')
    .select('id, full_name, employment_info')
    .eq('access_level', 8);

  const missing = allLevel8?.filter(e =>
    !e.employment_info?.employment_status ||
    e.employment_info?.employment_status !== 'active'
  );

  if (missing?.length > 0) {
    console.log('\n⚠️ Level 8 users missing or with non-active employment_status:');
    missing.forEach(m => {
      console.log(`  - ${m.full_name}: employment_status = "${m.employment_info?.employment_status || 'NOT SET'}"`);
    });
  } else {
    console.log('All Level 8 users have employment_status = "active"');
  }
}

testOrgScope();
