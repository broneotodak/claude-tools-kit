#!/usr/bin/env node

/**
 * THR Final Import Script
 * Clears existing data and imports fresh from both CSV and TXT files
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function clearExistingData() {
  console.log('🧹 Clearing existing data from master_hr2000...\n');
  
  const { error } = await supabase
    .from('master_hr2000')
    .delete()
    .neq('employee_no', ''); // Delete all records
  
  if (error) {
    throw new Error(`Failed to clear data: ${error.message}`);
  }
  
  const { count } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log(`✅ Table cleared. Current records: ${count || 0}\n`);
}

async function importData() {
  // Load the prepared data
  const dataFile = '/Users/broneotodak/Projects/claude-tools-kit/thr-import-data.json';
  console.log('📁 Loading data from:', dataFile);
  
  const allEmployees = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  console.log(`\n📊 Total employees to import: ${allEmployees.length}`);
  
  // Prepare records for master_hr2000 table
  const records = allEmployees.map(emp => ({
    employee_no: emp.employee_no,
    name: emp.name,
    organization_id: emp.organization_id,
    organization_code: emp.organization_code,
    
    // Personal details
    ic_no: emp.ic_no,
    old_ic_no: emp.csv_data.i_c_no_old_ || null,
    passport_no: emp.csv_data.passport_no || null,
    nationality: emp.nationality,
    race: emp.race,
    religion: emp.religion,
    gender: emp.gender,
    marital_status: emp.marital_status,
    birth_date: emp.birth_date,
    children_count: emp.children_count ? parseInt(emp.children_count) : null,
    
    // Contact
    email: emp.email?.replace(/\|$/, '').trim(),
    mobile_no: emp.mobile_no,
    home_phone: emp.csv_data.home_telephone || null,
    address: emp.address || null,
    
    // Employment
    department: emp.department,
    designation: emp.csv_data.designation || null,
    hire_date: emp.hire_date,
    resign_date: emp.csv_data.resign_date || null,
    confirm_date: emp.csv_data.confirm_date || null,
    
    // Payment
    current_basic: emp.current_basic ? parseFloat(emp.current_basic) : null,
    payment_type: emp.csv_data.payment_type || null,
    payment_frequency: emp.csv_data.payment_frequency || null,
    bank_code: emp.csv_data.bank_code_branch?.split('/')[0] || null,
    bank_account_no: emp.bank_account,
    
    // Statutory
    epf_no: emp.epf_no,
    socso_no: emp.socso_no,
    income_tax_no: emp.income_tax_no !== 'Overtime' ? emp.income_tax_no : null,
    
    // Metadata
    data_source: emp.import_source,
    csv_data: emp.csv_data,
    txt_data: emp.txt_data,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
  
  // Import in batches
  const batchSize = 50;
  let imported = 0;
  
  console.log(`\n🚀 Importing in batches of ${batchSize}...\n`);
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    
    const { data, error } = await supabase
      .from('master_hr2000')
      .insert(batch);
    
    if (error) {
      console.error(`❌ Error in batch ${Math.floor(i/batchSize) + 1}:`, error.message);
      console.error('First record in failed batch:', JSON.stringify(batch[0], null, 2));
    } else {
      imported += batch.length;
      console.log(`✅ Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} records imported (${imported}/${records.length})`);
    }
  }
  
  return imported;
}

async function verifyImport() {
  console.log('\n🔍 Verifying import...\n');
  
  // Get total count
  const { count } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total records in database: ${count}`);
  
  // Check by organization
  const { data: orgCounts } = await supabase
    .from('master_hr2000')
    .select('organization_code')
    .order('organization_code');
  
  const byOrg = {};
  orgCounts?.forEach(row => {
    byOrg[row.organization_code] = (byOrg[row.organization_code] || 0) + 1;
  });
  
  console.log('\nRecords by organization:');
  Object.entries(byOrg).sort().forEach(([org, count]) => {
    console.log(`  ${org}: ${count}`);
  });
  
  // Check data completeness
  const fields = [
    { name: 'IC Number', column: 'ic_no' },
    { name: 'Email', column: 'email' },
    { name: 'Mobile', column: 'mobile_no' },
    { name: 'Department', column: 'department' },
    { name: 'Bank Account', column: 'bank_account' },
    { name: 'EPF Number', column: 'epf_no' }
  ];
  
  console.log('\nData completeness:');
  for (const field of fields) {
    const { count: hasData } = await supabase
      .from('master_hr2000')
      .select('*', { count: 'exact', head: true })
      .not(field.column, 'is', null);
    
    const percent = ((hasData / count) * 100).toFixed(1);
    console.log(`  ${field.name}: ${hasData}/${count} (${percent}%)`);
  }
  
  // Check for duplicates
  const { data: duplicates } = await supabase.rpc('find_duplicate_employees');
  if (duplicates?.length > 0) {
    console.log(`\n⚠️  Found ${duplicates.length} employees in multiple organizations`);
  }
}

async function main() {
  try {
    console.log('🚀 THR Final Import Script\n');
    console.log('=' .repeat(60));
    console.log('\n⚠️  This will CLEAR all existing data in master_hr2000!');
    console.log('Data source: thr-import-data.json (518 employees)\n');
    
    // Confirm
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Proceed with import? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes') {
        try {
          await clearExistingData();
          const imported = await importData();
          await verifyImport();
          
          console.log('\n' + '=' .repeat(60));
          console.log(`\n✅ Import complete! ${imported} records imported.`);
        } catch (error) {
          console.error('\n❌ Import failed:', error.message);
        }
      } else {
        console.log('\n❌ Import cancelled.');
      }
      
      rl.close();
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}