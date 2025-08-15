const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrgSetup() {
  console.log('🔍 CHECKING THR ORGANIZATION SETUP\n');
  console.log('='.repeat(60));

  try {
    // 1. Check organizations table
    console.log('1. Organizations table:');
    const { data: orgs, error: orgError } = await supabase
      .from('thr_organizations')
      .select('*');
    
    if (orgError) {
      console.log('❌ Error:', orgError.message);
    } else {
      console.log(`Found ${orgs?.length || 0} organizations`);
      if (orgs && orgs.length > 0) {
        orgs.forEach(org => {
          console.log(`- ${org.code}: ${org.name}`);
        });
      }
    }

    // 2. Check unique organization_ids in employees
    console.log('\n2. Unique organization_ids in thr_employees:');
    const { data: employees } = await supabase
      .from('thr_employees')
      .select('organization_id')
      .not('organization_id', 'is', null);

    if (employees) {
      const uniqueOrgIds = [...new Set(employees.map(e => e.organization_id))];
      console.log(`Found ${uniqueOrgIds.length} unique organization IDs:`);
      uniqueOrgIds.forEach(id => {
        console.log(`- ${id}`);
      });
    }

    // 3. Check if we're looking at wrong database
    console.log('\n3. Database check:');
    console.log('Using URL:', process.env.ATLAS_SUPABASE_URL || process.env.VITE_SUPABASE_URL);
    
    // 4. Try alternate query
    console.log('\n4. Checking ATLAS organizations (shared database):');
    const { data: atlasOrgs } = await supabase
      .from('organizations')  // Try without thr_ prefix
      .select('*')
      .limit(5);
    
    if (atlasOrgs && atlasOrgs.length > 0) {
      console.log('✅ Found organizations in "organizations" table (ATLAS)');
      atlasOrgs.forEach(org => {
        console.log(`- ${org.code || org.name}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkOrgSetup();