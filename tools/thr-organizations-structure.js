#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrganizations() {
  console.log('📋 Checking thr_organizations table structure...\n');
  
  // First, get any data to see columns
  const { data: orgs, error } = await supabase
    .from('thr_organizations')
    .select('*')
    .limit(5);
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  if (orgs && orgs.length > 0) {
    console.log('Columns in thr_organizations:');
    Object.keys(orgs[0]).forEach(col => {
      console.log(`  - ${col}: ${typeof orgs[0][col]} (sample: ${JSON.stringify(orgs[0][col])?.substring(0, 50)})`);
    });
    
    console.log(`\n\nAll organizations (${orgs.length} shown):\n`);
    orgs.forEach((org, idx) => {
      console.log(`Record ${idx + 1}:`);
      Object.entries(org).forEach(([key, val]) => {
        console.log(`  ${key}: ${JSON.stringify(val)}`);
      });
      console.log('-'.repeat(40));
    });
  }
  
  // Get total count
  const { count } = await supabase
    .from('thr_organizations')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\nTotal organizations in table: ${count}`);
}

checkOrganizations().catch(console.error);