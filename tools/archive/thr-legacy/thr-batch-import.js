#!/usr/bin/env node

/**
 * THR Batch Import Tool
 * Imports all HR2000 CSV files with proper organization mapping
 */

const fs = require('fs').promises;
const path = require('path');
const { createMasterTable, migrateFromCSV } = require('./hr2000-fresh-migrator');
const { ensureOrganizationsExist } = require('./thr-organization-mapper');

const RAW_DATA_PATH = '/Users/broneotodak/Projects/THR/raw_data';

async function importAllFiles() {
  console.log('🚀 THR Batch Import Tool\n');
  console.log('=' .repeat(50));
  
  try {
    // Step 1: Ensure all organizations exist
    console.log('\n📋 Step 1: Setting up organizations...');
    const orgSetupSuccess = await ensureOrganizationsExist();
    if (!orgSetupSuccess) {
      console.error('❌ Failed to setup organizations');
      return;
    }
    
    // Step 2: Create master table
    console.log('\n📊 Step 2: Creating hr2000_master table...');
    await createMasterTable();
    
    // Step 3: Get all CSV files
    console.log('\n📁 Step 3: Finding CSV files...');
    const files = await fs.readdir(RAW_DATA_PATH);
    const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
    
    console.log(`Found ${csvFiles.length} CSV files to import:`);
    csvFiles.forEach(file => console.log(`  - ${file}`));
    
    // Step 4: Import each file
    console.log('\n📤 Step 4: Starting import process...\n');
    console.log('=' .repeat(50));
    
    let totalImported = 0;
    const results = [];
    
    for (const file of csvFiles) {
      const filePath = path.join(RAW_DATA_PATH, file);
      console.log(`\n🔄 Processing: ${file}`);
      console.log('-' .repeat(40));
      
      try {
        const count = await migrateFromCSV(filePath);
        totalImported += count;
        results.push({ file, status: 'success', count });
      } catch (error) {
        console.error(`❌ Error processing ${file}: ${error.message}`);
        results.push({ file, status: 'error', error: error.message });
      }
    }
    
    // Step 5: Summary
    console.log('\n' + '=' .repeat(50));
    console.log('📊 IMPORT SUMMARY\n');
    
    console.log('Results by file:');
    results.forEach(result => {
      if (result.status === 'success') {
        console.log(`  ✅ ${result.file}: ${result.count} employees`);
      } else {
        console.log(`  ❌ ${result.file}: ${result.error}`);
      }
    });
    
    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`\nTotal: ${totalImported} employees imported from ${successCount}/${csvFiles.length} files`);
    
    // Step 6: Verify data
    console.log('\n🔍 Verifying imported data...');
    const { createClient } = require('@supabase/supabase-js');
    require('dotenv').config();
    
    const supabase = createClient(
      process.env.ATLAS_SUPABASE_URL,
      process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
    );
    
    const { count } = await supabase
      .from('hr2000_master')
      .select('*', { count: 'exact', head: true });
      
    console.log(`\n✅ Database now contains ${count} total employees`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Single file import
async function importSingleFile(filename) {
  try {
    // Ensure organizations exist
    await ensureOrganizationsExist();
    
    // Create table if needed
    await createMasterTable();
    
    // Import file
    const filePath = path.join(RAW_DATA_PATH, filename);
    const count = await migrateFromCSV(filePath);
    
    console.log(`\n✅ Successfully imported ${count} employees from ${filename}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Main CLI
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'all':
      await importAllFiles();
      break;
      
    case 'file':
      const filename = process.argv[3];
      if (!filename) {
        console.error('Please specify a filename');
        process.exit(1);
      }
      await importSingleFile(filename);
      break;
      
    default:
      console.log('THR Batch Import Tool\n');
      console.log('Commands:');
      console.log('  all              - Import all CSV files');
      console.log('  file <filename>  - Import specific file');
      console.log('\nExamples:');
      console.log('  ./thr-batch-import.js all');
      console.log('  ./thr-batch-import.js file "TCSB_Employee Master.csv"');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { importAllFiles };