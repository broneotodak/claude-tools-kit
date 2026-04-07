#!/usr/bin/env node

/**
 * THR Import Script - Matched to actual master_hr2000 schema
 * 
 * Discovered schema fields:
 * - employee_no (required)
 * - organization_id (required, foreign key)
 * - ic_no, nationality, race, religion, gender, marital_status
 * - mobile, address, department, designation
 * - basic_salary, socso_no
 * - data_source, created_at, updated_at
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Organization mapping - ALL organizations from thr_organizations table
const ORG_MAPPING = {
  '10C': 'c0e88906-a48a-4848-b558-7f547c3f8abb',    // 10 Camp Enterprise
  'HSB': '7b492291-37b0-4611-b71f-0ddcfb7ca040',    // Hyleen Sdn. Bhd.
  'LTCM': '7bf98516-0582-4b6c-8231-1f693e4da9b4',   // Lan Todak Consultation & Management
  'MH': '56c85dcf-3980-40fb-9d44-5e330b0df782',     // Muscle Hub
  'MTSB': '0076fffc-282f-4966-8c26-b2483b3b1a8a',   // My Barber Tech Sdn. Bhd.
  'STSB': '938f1186-e25a-475d-bc7a-17bae41b58d5',   // Sarcom Technology Sdn. Bhd.
  'TASB': '951492dc-a480-4391-85a6-f2738ceff92b',   // Todak Academy Sdn. Bhd.
  'TCSB': '5132ee4b-69f2-4263-8857-e56d649ac62b',   // Todak Culture Sdn. Bhd.
  'TDSB': '8b1a378b-9428-4e81-b616-8e0b25b78fca',   // Todak Digitech Sdn. Bhd.
  'THSB': 'd0c746b5-f54f-45e1-ac9c-ae2a22c43e95',   // Todak Holdings Sdn. Bhd.
  'TPSB': 'ce34cd6f-fcd5-43f2-98b4-d9f8614fba28',   // Todak Paygate Sdn. Bhd.
  'TRC': '65c96eb4-1603-4119-ab10-2658d38764f4',    // Todak RC Enterprise
  'TSSB': '7c154cd5-4773-4f27-a136-e60ab2bfe0a2',   // Todak Studios Sdn. Bhd.
  'TTK': '6e0cff12-3d6d-4dc2-8291-52cae49e734b'     // Tadika Todak Kids
};

async function clearExistingData() {
  console.log('🧹 Clearing existing data from master_hr2000...\n');
  
  const { error } = await supabase
    .from('master_hr2000')
    .delete()
    .neq('employee_no', ''); // Delete all records
  
  if (error) {
    console.log('Warning:', error.message);
  }
  
  const { count } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log(`✅ Table cleared. Current records: ${count || 0}\n`);
}

function transformToSchema(emp) {
  // Map our merged data to the actual table columns
  return {
    // Required fields
    employee_no: emp.employee_no,
    organization_id: ORG_MAPPING[emp.organization_code],
    
    // Personal fields (that exist in table)
    ic_no: emp.ic_no || null,
    nationality: emp.nationality || null,
    race: emp.race || null,
    religion: emp.religion || null,
    gender: emp.gender || null,
    marital_status: emp.marital_status || null,
    
    // Contact fields
    mobile: emp.mobile_no || null,
    address: emp.address || null,
    
    // Employment fields
    department: emp.department || null,
    designation: emp.csv_data?.designation || null,
    
    // Financial fields
    basic_salary: emp.current_basic ? parseFloat(emp.current_basic) : null,
    
    // Statutory fields
    socso_no: emp.socso_no || null,
    
    // Metadata
    data_source: 'hr2000_import',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function importData() {
  // Load the prepared data
  const dataFile = '/Users/broneotodak/Projects/claude-tools-kit/thr-import-data.json';
  console.log('📁 Loading data from:', dataFile);
  
  const allEmployees = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  console.log(`\n📊 Total employees to import: ${allEmployees.length}`);
  
  // Filter employees with valid organization codes
  const validEmployees = allEmployees.filter(emp => ORG_MAPPING[emp.organization_code]);
  console.log(`✅ Employees with valid organizations: ${validEmployees.length}`);
  
  const invalidOrgs = allEmployees.filter(emp => !ORG_MAPPING[emp.organization_code]);
  if (invalidOrgs.length > 0) {
    console.log(`⚠️  Skipping ${invalidOrgs.length} employees with unmapped organizations`);
  }
  
  // Transform to match schema
  const records = validEmployees.map(transformToSchema);
  
  // Import in batches
  const batchSize = 50;
  let imported = 0;
  const errors = [];
  
  console.log(`\n🚀 Importing in batches of ${batchSize}...\n`);
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchNum = Math.floor(i/batchSize) + 1;
    
    const { data, error } = await supabase
      .from('master_hr2000')
      .insert(batch)
      .select();
    
    if (error) {
      console.error(`❌ Error in batch ${batchNum}:`, error.message);
      errors.push({ batch: batchNum, error: error.message, sample: batch[0] });
    } else {
      imported += data.length;
      console.log(`✅ Batch ${batchNum}: ${data.length} records imported (${imported}/${records.length})`);
    }
  }
  
  if (errors.length > 0) {
    console.log('\n⚠️  Import errors:');
    errors.forEach(e => {
      console.log(`Batch ${e.batch}: ${e.error}`);
      console.log('Sample record:', JSON.stringify(e.sample, null, 2));
    });
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
  const { data: orgData } = await supabase
    .from('master_hr2000')
    .select('organization_id');
  
  if (orgData) {
    const byOrg = {};
    orgData.forEach(row => {
      byOrg[row.organization_id] = (byOrg[row.organization_id] || 0) + 1;
    });
    
    console.log('\nRecords by organization:');
    const reverseMapping = Object.entries(ORG_MAPPING).reduce((acc, [code, id]) => {
      acc[id] = code;
      return acc;
    }, {});
    
    Object.entries(byOrg).forEach(([orgId, count]) => {
      const code = reverseMapping[orgId] || 'Unknown';
      console.log(`  ${code}: ${count}`);
    });
  }
  
  // Check data completeness
  const fields = [
    { name: 'IC Number', column: 'ic_no' },
    { name: 'Mobile', column: 'mobile' },
    { name: 'Department', column: 'department' },
    { name: 'Basic Salary', column: 'basic_salary' },
    { name: 'SOCSO Number', column: 'socso_no' }
  ];
  
  console.log('\nData completeness:');
  for (const field of fields) {
    const { count: hasData } = await supabase
      .from('master_hr2000')
      .select('*', { count: 'exact', head: true })
      .not(field.column, 'is', null)
      .neq(field.column, '');
    
    const percent = count > 0 ? ((hasData / count) * 100).toFixed(1) : 0;
    console.log(`  ${field.name}: ${hasData}/${count} (${percent}%)`);
  }
  
  // Show sample records
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(3);
  
  if (samples && samples.length > 0) {
    console.log('\nSample imported records:');
    samples.forEach((record, idx) => {
      console.log(`\nRecord ${idx + 1}:`);
      console.log(`  Employee: ${record.employee_no}`);
      console.log(`  IC: ${record.ic_no || 'N/A'}`);
      console.log(`  Department: ${record.department || 'N/A'}`);
      console.log(`  Mobile: ${record.mobile || 'N/A'}`);
    });
  }
}

async function main() {
  try {
    console.log('🚀 THR Import Script (Schema-Matched)\n');
    console.log('=' .repeat(60));
    console.log('\n⚠️  This will CLEAR all existing data in master_hr2000!');
    console.log('Data source: thr-import-data.json (518 employees)');
    console.log('Target organizations: ALL 14 organizations\n');
    
    // Show what will be imported
    const dataFile = '/Users/broneotodak/Projects/claude-tools-kit/thr-import-data.json';
    const allEmployees = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    
    const orgCounts = {};
    allEmployees.forEach(emp => {
      orgCounts[emp.organization_code] = (orgCounts[emp.organization_code] || 0) + 1;
    });
    
    console.log('Employees per organization:');
    Object.entries(orgCounts).sort().forEach(([code, count]) => {
      const mapped = ORG_MAPPING[code] ? '✅' : '❌';
      console.log(`  ${mapped} ${code}: ${count} employees`);
    });
    
    // Confirm
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\nProceed with import? (yes/no): ', async (answer) => {
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