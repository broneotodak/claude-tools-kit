#!/usr/bin/env node

/**
 * THR Import Script - Full Schema Matched
 * Maps our data to ALL available columns in master_hr2000
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

function parseDate(dateStr) {
  if (!dateStr || dateStr === 'Overtime') return null;
  // Handle various date formats
  const cleaned = dateStr.replace(/['"]/g, '').trim();
  if (!cleaned || cleaned === '0' || cleaned === '') return null;
  
  // Try to parse DD/MM/YYYY format
  const parts = cleaned.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  return null;
}

function transformToFullSchema(emp) {
  // Map our merged data to ALL available columns in master_hr2000
  return {
    // Required fields
    employee_no: emp.employee_no,
    organization_id: ORG_MAPPING[emp.organization_code],
    
    // Employee name - THIS WAS MISSING!
    employee_name: emp.name || emp.csv_data?.name || null,
    
    // Personal identification
    ic_no: emp.ic_no || null,
    
    // Employment dates
    employment_date: parseDate(emp.hire_date) || parseDate(emp.csv_data?.hire_date),
    confirmation_date: parseDate(emp.csv_data?.confirm_date),
    
    // Status
    active_status: !emp.csv_data?.resign_date,
    
    // Work details
    staff_category: emp.csv_data?.employee_category || null,
    branch: emp.csv_data?.branch || null,
    department: emp.department || null,
    section: emp.csv_data?.section || null,
    designation: emp.csv_data?.designation || null,
    reporting_to: emp.csv_data?.reporting_to || null,
    grade: emp.csv_data?.grade || null,
    
    // Personal details
    race: emp.race || null,
    religion: emp.religion || null,
    marital_status: emp.marital_status || null,
    gender: emp.gender || null,
    date_of_birth: parseDate(emp.birth_date) || parseDate(emp.csv_data?.birth_date),
    birth_place: emp.csv_data?.birth_place || null,
    nationality: emp.nationality || null,
    citizen: emp.csv_data?.citizen || null,
    pr_status: emp.csv_data?.pr_status || null,
    
    // Contact information
    mobile: emp.mobile_no || null,
    personal_email: emp.email?.replace(/\|$/, '').trim() || null,
    company_email: emp.csv_data?.company_email || null,
    address: emp.address || null,
    address2: emp.address2 || null,
    city: emp.city || null,
    state: emp.state || null,
    postcode: emp.postcode || null,
    country: emp.country || null,
    
    // Salary information
    basic_salary: emp.current_basic ? parseFloat(emp.current_basic) : 
                  (emp.csv_data?.basic_salary ? parseFloat(emp.csv_data.basic_salary) : 0),
    total_allowance: emp.total_allowance ? parseFloat(emp.total_allowance) : 0,
    total_deduction: emp.total_deduction ? parseFloat(emp.total_deduction) : 0,
    net_salary: emp.net_salary ? parseFloat(emp.net_salary) : null,
    
    // Banking information
    bank_name: emp.csv_data?.bank_code_branch?.split('/')[0] || null,
    bank_acc_no: emp.bank_account || null,
    bank_branch: emp.csv_data?.bank_code_branch?.split('/')[1] || null,
    
    // Spouse information (from TXT data)
    spouse_name: emp.spouse_name || null,
    spouse_ic: emp.spouse_ic_new || null,
    spouse_occupation: emp.spouse_occupation || null,
    spouse_employer: emp.spouse_employer || null,
    spouse_employment_date: parseDate(emp.spouse_hire_date),
    spouse_dob: parseDate(emp.spouse_birth_date),
    
    // Statutory information
    socso_no: emp.socso_no || null,
    kwsp_no: emp.epf_no || null,
    lhdn_no: emp.income_tax_no !== 'Overtime' ? emp.income_tax_no : null,
    perkeso_code: emp.csv_data?.perkeso_code || null,
    
    // Contribution rates
    kwsp_employer: emp.csv_data?.kwsp_employer ? parseFloat(emp.csv_data.kwsp_employer) : null,
    kwsp_employee: emp.csv_data?.kwsp_employee ? parseFloat(emp.csv_data.kwsp_employee) : null,
    pcb: emp.csv_data?.pcb || null,
    eis_employer: emp.csv_data?.eis_employer ? parseFloat(emp.csv_data.eis_employer) : null,
    eis_employee: emp.csv_data?.eis_employee ? parseFloat(emp.csv_data.eis_employee) : null,
    socso_employer: emp.csv_data?.socso_employer ? parseFloat(emp.csv_data.socso_employer) : null,
    socso_employee: emp.csv_data?.socso_employee ? parseFloat(emp.csv_data.socso_employee) : null,
    
    // Form type
    ea_form: emp.csv_data?.ea_form || null,
    
    // Fixed allowances (if any)
    fixed_allowances: emp.allowances || [],
    
    // Metadata
    data_source: 'hr2000_full_import',
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
  
  // Transform to match full schema
  const records = allEmployees.map(transformToFullSchema);
  
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
  
  // Check key fields completeness
  const fields = [
    { name: 'Employee Name', column: 'employee_name' },
    { name: 'IC Number', column: 'ic_no' },
    { name: 'Employment Date', column: 'employment_date' },
    { name: 'Department', column: 'department' },
    { name: 'Designation', column: 'designation' },
    { name: 'Mobile', column: 'mobile' },
    { name: 'Email', column: 'personal_email' },
    { name: 'Basic Salary', column: 'basic_salary' },
    { name: 'Bank Account', column: 'bank_acc_no' },
    { name: 'EPF Number', column: 'kwsp_no' },
    { name: 'SOCSO Number', column: 'socso_no' },
    { name: 'Spouse Name', column: 'spouse_name' }
  ];
  
  console.log('\nData completeness:');
  for (const field of fields) {
    const { count: hasData } = await supabase
      .from('master_hr2000')
      .select('*', { count: 'exact', head: true })
      .not(field.column, 'is', null)
      .neq(field.column, '');
    
    const percent = count > 0 ? ((hasData / count) * 100).toFixed(1) : 0;
    const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
    console.log(`  ${field.name.padEnd(20)} ${bar} ${percent}% (${hasData}/${count})`);
  }
  
  // Show sample records with names
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, ic_no, department, designation, mobile')
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\nSample imported records:');
    samples.forEach((record, idx) => {
      console.log(`\n${idx + 1}. ${record.employee_no} - ${record.employee_name || 'NO NAME'}`);
      console.log(`   IC: ${record.ic_no || 'N/A'}`);
      console.log(`   Dept: ${record.department || 'N/A'} | Position: ${record.designation || 'N/A'}`);
      console.log(`   Mobile: ${record.mobile || 'N/A'}`);
    });
  }
}

async function main() {
  try {
    console.log('🚀 THR Full Schema Import Script\n');
    console.log('=' .repeat(60));
    console.log('\n⚠️  This will CLEAR all existing data and re-import with ALL fields!');
    console.log('Data source: thr-import-data.json (518 employees)');
    console.log('This import includes: employee names, spouse info, addresses, etc.\n');
    
    // Confirm
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Proceed with full import? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes') {
        try {
          await clearExistingData();
          const imported = await importData();
          await verifyImport();
          
          console.log('\n' + '=' .repeat(60));
          console.log(`\n✅ Full import complete! ${imported} records imported with all available data.`);
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