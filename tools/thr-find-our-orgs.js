#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function findOurOrganizations() {
  console.log('🔍 Finding organizations for our data...\n');
  
  // Get all organizations
  const { data: allOrgs, error } = await supabase
    .from('thr_organizations')
    .select('organization_id, name, organization_code')
    .order('organization_code');
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  console.log(`Total organizations in database: ${allOrgs.length}\n`);
  
  // Our required organizations from the data
  const requiredOrgs = {
    '10C': '10Camp',
    'HSB': 'Hyleen Sdn. Bhd.',
    'MH': 'Muscle Hub',
    'STSB': 'Sarcom Technology Sdn. Bhd.'
  };
  
  console.log('Searching for our required organizations:\n');
  
  const foundOrgs = {};
  
  Object.entries(requiredOrgs).forEach(([code, expectedName]) => {
    // Try to find by code
    const byCode = allOrgs.find(org => org.organization_code === code);
    
    // Try to find by name (partial match)
    const byName = allOrgs.find(org => 
      org.name.toLowerCase().includes(expectedName.toLowerCase()) ||
      expectedName.toLowerCase().includes(org.name.toLowerCase())
    );
    
    if (byCode) {
      console.log(`✅ Found by code '${code}': ${byCode.name} (ID: ${byCode.organization_id})`);
      foundOrgs[code] = byCode.organization_id;
    } else if (byName) {
      console.log(`⚠️  Found by name match for '${code}' (${expectedName}): ${byName.name} (ID: ${byName.organization_id})`);
      foundOrgs[code] = byName.organization_id;
    } else {
      console.log(`❌ NOT FOUND: ${code} (${expectedName})`);
    }
  });
  
  // Show all organizations for reference
  console.log('\n\nAll organizations in database:');
  console.log('Code | Name | ID');
  console.log('-'.repeat(80));
  allOrgs.forEach(org => {
    console.log(`${org.organization_code.padEnd(6)} | ${org.name.padEnd(40)} | ${org.organization_id}`);
  });
  
  // Save mapping for import
  if (Object.keys(foundOrgs).length > 0) {
    const mapping = {
      found: foundOrgs,
      missing: Object.keys(requiredOrgs).filter(code => !foundOrgs[code])
    };
    
    console.log('\n\n📝 Organization mapping for import:');
    console.log(JSON.stringify(mapping, null, 2));
  }
}

findOurOrganizations().catch(console.error);