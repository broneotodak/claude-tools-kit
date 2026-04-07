#!/usr/bin/env node

/**
 * THR Data Check - Analyze existing tables and data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkMasterHR2000() {
  console.log('📊 Checking master_hr2000 table...\n');
  
  // Get count
  const { count } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total records: ${count}`);
  
  // Get sample to see structure
  const { data: sample } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(3);
  
  if (sample && sample.length > 0) {
    console.log('\nTable structure (columns):');
    console.log(Object.keys(sample[0]).join(', '));
    
    console.log('\nSample data:');
    sample.forEach((row, i) => {
      console.log(`\nRecord ${i + 1}:`);
      console.log(`  Employee: ${row.employee_no}`);
      console.log(`  Branch: ${row.branch}`);
      console.log(`  Organization ID: ${row.organization_id}`);
      console.log(`  Active: ${row.active_status}`);
    });
  }
  
  // Check data sources
  const { data: sources } = await supabase
    .from('master_hr2000')
    .select('data_source, branch')
    .limit(1000);
  
  const sourceCounts = {};
  const branchCounts = {};
  
  sources?.forEach(row => {
    sourceCounts[row.data_source] = (sourceCounts[row.data_source] || 0) + 1;
    branchCounts[row.branch] = (branchCounts[row.branch] || 0) + 1;
  });
  
  console.log('\nData sources:');
  Object.entries(sourceCounts).forEach(([source, count]) => {
    console.log(`  ${source}: ${count} records`);
  });
  
  console.log('\nBranches (Organizations):');
  Object.entries(branchCounts).forEach(([branch, count]) => {
    console.log(`  ${branch}: ${count} records`);
  });
}

async function checkThrEmployees() {
  console.log('\n\n📊 Checking thr_employees table...\n');
  
  const { count } = await supabase
    .from('thr_employees')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total records: ${count}`);
  
  if (count > 0) {
    const { data: sample } = await supabase
      .from('thr_employees')
      .select('*')
      .limit(1);
    
    if (sample && sample.length > 0) {
      console.log('\nTable structure (columns):');
      console.log(Object.keys(sample[0]).join(', '));
    }
  }
}

async function cleanThrEmployees() {
  console.log('\n\n🧹 Cleaning thr_employees table...\n');
  
  const { error } = await supabase
    .from('thr_employees')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
  
  if (error) {
    console.error('❌ Error:', error.message);
  } else {
    console.log('✅ Cleaned thr_employees table');
  }
}

async function main() {
  const command = process.argv[2];
  
  console.log('🔍 THR Data Check Tool\n');
  console.log('=' .repeat(50));
  
  try {
    await checkMasterHR2000();
    await checkThrEmployees();
    
    if (command === 'clean') {
      await cleanThrEmployees();
    }
    
    console.log('\n✅ Check complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}