#!/usr/bin/env node

/**
 * THR Import Missing Organizations
 * Imports only the missing organizations into existing master_hr2000
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { ORGANIZATION_MAPPINGS } = require('./thr-organization-mapper');

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Missing organizations based on current data
const MISSING_ORGS = ['10C', 'HSB', 'LTCM', 'TDSB', 'THSB', 'TTK'];

// Parse HR2000 CSV format
function parseHR2000File(content, filePrefix) {
  const lines = content.split('\n').map(line => line.trim());
  const employees = [];
  let currentEmployee = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    
    const columns = line.split(',').map(col => col.trim());
    
    if (columns[0] === 'Employee No.' && columns[3]) {
      if (currentEmployee && currentEmployee.employee_no) {
        employees.push(currentEmployee);
      }
      
      currentEmployee = {
        employee_no: columns[3],
        branch: filePrefix,
        raw_data: {}
      };
    }
    
    if (currentEmployee && columns[0] && columns[3]) {
      const key = columns[0].replace(':', '').trim();
      let value = columns[3];
      
      if (value && value.includes('RM')) {
        value = value.replace('RM', '').replace(/,/g, '').replace(/"/g, '').trim();
      }
      
      currentEmployee.raw_data[key] = value;
      
      if (columns[5] && columns[8]) {
        const key2 = columns[5].replace(':', '').trim();
        const value2 = columns[8];
        currentEmployee.raw_data[key2] = value2;
      }
    }
  }
  
  if (currentEmployee && currentEmployee.employee_no) {
    employees.push(currentEmployee);
  }
  
  return employees;
}

// Transform to master_hr2000 format
function transformToMasterFormat(employee, orgMapping) {
  const data = employee.raw_data;
  
  // Parse date
  const parseDate = (dateStr) => {
    if (!dateStr || dateStr === '/ /' || dateStr === '') return null;
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    return null;
  };
  
  return {
    employee_no: employee.employee_no,
    employee_name: data['Name'] || null,
    ic_no: data['I/C No. (New)'] || data['I/C No. (OLD)'] || null,
    employment_date: parseDate(data['HireDate']),
    confirmation_date: parseDate(data['Confirm Date']),
    active_status: !data['Resign Date'] || data['Resign Date'] === '/ /',
    staff_category: data['Category'] || null,
    branch: employee.branch,
    department: data['Department'] || null,
    section: data['Section'] || null,
    designation: data['Position'] || data['Designation'] || null,
    race: data['Race'] || null,
    religion: data['Religion'] || null,
    marital_status: data['Marital Status'] || null,
    gender: data['Sex'] || null,
    date_of_birth: parseDate(data['Birth Date']),
    nationality: data['Nationality'] || null,
    citizen: data['Nationality'] === 'WARGANEGARA',
    mobile: data['Mobile'] || data['Phone'] || null,
    personal_email: data['Personal Email'] || null,
    company_email: data['E-Mail'] || data['Email'] || null,
    basic_salary: parseFloat(data['Current Basic']) || 0,
    bank_name: data['Bank Code/ Branch'] ? data['Bank Code/ Branch'].split('/')[0] : null,
    bank_acc_no: data['Bank Account No'] || null,
    spouse_name: data['Spouse Name'] || null,
    spouse_ic: data['Spouse IC'] || '/',
    socso_no: data['SOCSO / KSPA No'] || data['Socso No.'] || null,
    kwsp_no: data['Epf No'] || data['EPF No.'] || null,
    lhdn_no: data['Income Tax No'] || null,
    organization_id: orgMapping ? orgMapping.id : null,
    data_source: `${employee.branch}_Employee_Master`,
    fixed_allowances: []
  };
}

// Clean existing data for specific organizations
async function cleanExistingData(orgCodes) {
  console.log('\n🧹 Cleaning existing data for organizations:', orgCodes.join(', '));
  
  for (const code of orgCodes) {
    const { error } = await supabase
      .from('master_hr2000')
      .delete()
      .eq('branch', code);
    
    if (error) {
      console.error(`  ❌ Error cleaning ${code}: ${error.message}`);
    } else {
      console.log(`  ✅ Cleaned ${code} data`);
    }
  }
}

// Import single file
async function importFile(filePath) {
  const filename = path.basename(filePath);
  const filePrefix = filename.split('_')[0];
  
  if (!MISSING_ORGS.includes(filePrefix)) {
    console.log(`  ⏭️  Skipping ${filename} (already imported)`);
    return 0;
  }
  
  const orgMapping = ORGANIZATION_MAPPINGS[filePrefix];
  
  console.log(`\n📁 Importing: ${filename}`);
  console.log(`  Organization: ${orgMapping ? orgMapping.name : 'Unknown'} (${filePrefix})`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const employees = parseHR2000File(content, filePrefix);
    
    console.log(`  Found ${employees.length} employees`);
    
    const transformedEmployees = employees
      .map(emp => transformToMasterFormat(emp, orgMapping))
      .filter(emp => emp.employee_name && emp.employee_name !== '');
    
    console.log(`  Valid employees: ${transformedEmployees.length}`);
    
    if (transformedEmployees.length === 0) {
      return 0;
    }
    
    // Insert in batches
    const batchSize = 20;
    let inserted = 0;
    
    for (let i = 0; i < transformedEmployees.length; i += batchSize) {
      const batch = transformedEmployees.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from('master_hr2000')
        .insert(batch)
        .select();
      
      if (error) {
        console.error(`  ❌ Batch error: ${error.message}`);
      } else {
        inserted += data.length;
        console.log(`  Progress: ${inserted}/${transformedEmployees.length}`);
      }
    }
    
    console.log(`  ✅ Imported ${inserted} employees`);
    return inserted;
    
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return 0;
  }
}

// Clean thr_employees table
async function cleanThrEmployees() {
  console.log('\n🧹 Cleaning thr_employees table...');
  
  const { error } = await supabase
    .from('thr_employees')
    .delete()
    .gte('user_id', '00000000-0000-0000-0000-000000000000'); // Delete all
  
  if (error) {
    console.error('❌ Error:', error.message);
  } else {
    console.log('✅ Cleaned thr_employees table');
  }
}

// Main import function
async function importMissing() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  
  console.log('🚀 THR Import Missing Organizations\n');
  console.log('=' .repeat(50));
  console.log('\nMissing organizations to import:', MISSING_ORGS.join(', '));
  
  // Clean existing data for missing orgs (in case of partial imports)
  await cleanExistingData(MISSING_ORGS);
  
  // Get CSV files
  const files = fs.readdirSync(rawDataPath)
    .filter(f => f.endsWith('.csv'))
    .sort();
  
  let totalImported = 0;
  const results = [];
  
  for (const file of files) {
    const count = await importFile(path.join(rawDataPath, file));
    if (count > 0) {
      totalImported += count;
      results.push({ file, count });
    }
  }
  
  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 IMPORT SUMMARY\n');
  
  results.forEach(({ file, count }) => {
    console.log(`  ${file}: ${count} employees`);
  });
  
  console.log(`\n✅ Total imported: ${totalImported} employees`);
  
  // Verify new total
  const { count } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log(`📊 Database total: ${count} employees (was 366, added ${count - 366})`);
  
  // Clean thr_employees if requested
  if (process.argv[2] === '--clean-thr') {
    await cleanThrEmployees();
  }
}

// Main CLI
async function main() {
  try {
    await importMissing();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}