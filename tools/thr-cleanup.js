#!/usr/bin/env node

/**
 * THR Cleanup Tool
 * Removes duplicate organizations and cleans thr_ tables
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function removeDuplicateOrganizations() {
  console.log('🧹 Removing duplicate organizations created today...\n');
  
  // Remove duplicates created on 2025-07-11
  const duplicateIds = [
    '9412e1e0-154a-4e60-bdf4-bb1872d5954d', // 10Camp duplicate
    '9c42ef2a-48a1-49de-828a-d1b2716bd2b4', // Hyleen duplicate
    '8a1bcba6-1bf7-4e92-a84f-474070b17b67', // Muscle Hub duplicate
    '1a7966f5-bf90-4a0e-83ec-39ecc64c991e', // Sarcom duplicate
    '9066ed0a-bf0b-42b2-bc36-1df76b51314d'  // Another 10Camp duplicate
  ];
  
  for (const id of duplicateIds) {
    const { error } = await supabase
      .from('thr_organizations')
      .delete()
      .eq('organization_id', id);
    
    if (error) {
      console.error(`❌ Error deleting ${id}: ${error.message}`);
    } else {
      console.log(`✅ Deleted duplicate: ${id}`);
    }
  }
}

async function cleanThrTables() {
  console.log('\n🧹 Cleaning thr_ tables (except thr_brands, thr_organizations, thr_atlas_*)...\n');
  
  // Get all tables
  const { data: tables } = await supabase
    .rpc('get_table_names', {
      schema_name: 'public'
    })
    .catch(() => ({ data: null }));
  
  if (!tables) {
    console.log('Using alternative method to find tables...\n');
    
    // List of known thr_ tables to clean
    const tablesToClean = [
      'thr_employees',
      'thr_staff',
      'thr_departments',
      'thr_salaries',
      'thr_leave_records',
      'thr_attendance',
      'thr_payroll'
    ];
    
    for (const table of tablesToClean) {
      // Skip protected tables
      if (table === 'thr_brands' || table === 'thr_organizations' || table.startsWith('thr_atlas_')) {
        continue;
      }
      
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .catch(() => ({ count: null }));
      
      if (count !== null) {
        console.log(`Found table: ${table} (${count} rows)`);
        
        if (count > 0) {
          const { error } = await supabase
            .from(table)
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
          
          if (error) {
            console.error(`  ❌ Error cleaning ${table}: ${error.message}`);
          } else {
            console.log(`  ✅ Cleaned ${table}`);
          }
        }
      }
    }
  }
}

async function checkMasterTable() {
  console.log('\n🔍 Checking for master_hr2000 table...\n');
  
  const { data, count } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .catch(err => ({ data: null, count: null, error: err }));
  
  if (count !== null) {
    console.log(`✅ Found master_hr2000 table with ${count} rows`);
    
    // Get table structure
    const { data: sample } = await supabase
      .from('master_hr2000')
      .select('*')
      .limit(1);
    
    if (sample && sample.length > 0) {
      console.log('\nTable columns:');
      console.log(Object.keys(sample[0]).join(', '));
    }
  } else {
    console.log('❌ master_hr2000 table not found');
  }
}

async function main() {
  console.log('🚀 THR Cleanup Tool\n');
  console.log('=' .repeat(50));
  
  try {
    await removeDuplicateOrganizations();
    await cleanThrTables();
    await checkMasterTable();
    
    console.log('\n✅ Cleanup complete!');
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}