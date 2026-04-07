#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrganizations() {
  console.log('📋 Checking thr_organizations table...\n');
  
  const { data: orgs, error } = await supabase
    .from('thr_organizations')
    .select('*')
    .order('code');
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  console.log(`Found ${orgs.length} organizations:\n`);
  
  orgs.forEach(org => {
    console.log(`Code: ${org.code}`);
    console.log(`Name: ${org.name}`);
    console.log(`ID: ${org.id}`);
    console.log(`Active: ${org.is_active}`);
    console.log('-'.repeat(40));
  });
  
  // Map our data codes to organization IDs
  console.log('\nMapping for our data:');
  const ourCodes = ['10C', 'HSB', 'MH', 'STSB'];
  ourCodes.forEach(code => {
    const org = orgs.find(o => o.code === code);
    if (org) {
      console.log(`✅ ${code} → ${org.id} (${org.name})`);
    } else {
      console.log(`❌ ${code} → NOT FOUND`);
    }
  });
}

checkOrganizations().catch(console.error);