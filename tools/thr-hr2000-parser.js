#!/usr/bin/env node

/**
 * THR HR2000 Format Parser
 * Parses the specific HR2000 CSV format with key-value pairs
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { ORGANIZATION_MAPPINGS, ensureOrganizationsExist } = require('./thr-organization-mapper');

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse HR2000 format
function parseHR2000File(content, filePrefix) {
  const lines = content.split('\n').map(line => line.trim());
  const employees = [];
  let currentEmployee = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    
    const columns = line.split(',').map(col => col.trim());
    
    // Check for employee number
    if (columns[0] === 'Employee No.' && columns[3]) {
      // Save previous employee if exists
      if (currentEmployee && currentEmployee.employee_id) {
        employees.push(currentEmployee);
      }
      
      // Start new employee
      currentEmployee = {
        employee_id: columns[3],
        organization_code: filePrefix,
        raw_data: {}
      };
    }
    
    // Parse key-value pairs
    if (currentEmployee && columns[0] && columns[3]) {
      const key = columns[0].replace(':', '').trim();
      let value = columns[3];
      
      // Clean numeric values
      if (value && value.includes('RM')) {
        value = value.replace('RM', '').replace(/,/g, '').replace(/"/g, '').trim();
      }
      
      currentEmployee.raw_data[key] = value;
      
      // Also check for second key-value pair in same line
      if (columns[5] && columns[8]) {
        const key2 = columns[5].replace(':', '').trim();
        const value2 = columns[8];
        currentEmployee.raw_data[key2] = value2;
      }
      
      // Special handling for fields that might be in different positions
      if (key === 'E-Mail' && columns[4]) {
        currentEmployee.raw_data[key] = columns[4].replace('|', '').trim();
      }
    }
  }
  
  // Don't forget the last employee
  if (currentEmployee && currentEmployee.employee_id) {
    employees.push(currentEmployee);
  }
  
  return employees;
}

// Transform to database format
function transformToDBFormat(employee, orgMapping) {
  const data = employee.raw_data;
  
  // Parse dates
  const parseDate = (dateStr) => {
    if (!dateStr || dateStr === '/ /' || dateStr === '') return null;
    // Handle format like "11/02/1983 (42 yrs)"
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`; // Convert to YYYY-MM-DD
    }
    return null;
  };
  
  // Determine active status
  const isActive = !data['Resign Date'] || data['Resign Date'] === '/ /' || data['Resign Date'] === '';
  
  return {
    employee_id: employee.employee_id,
    full_name: (data['Name'] || 'PENDING_UPDATE').toUpperCase(),
    email: data['E-Mail'] || data['Email'] || null,
    organization_id: orgMapping ? orgMapping.id : null,
    active: isActive,
    
    personal_data: {
      ic_number_new: data['I/C No. (New)'] || null,
      ic_number_old: data['I/C No. (OLD)'] || null,
      passport_number: data['Passport No.'] || null,
      nationality: data['Nationality'] || null,
      race: data['Race'] || null,
      religion: data['Religion'] || null,
      gender: data['Sex'] || null,
      marital_status: data['Marital Status'] || null,
      birth_date: parseDate(data['Birth Date']),
      children_count: data['No. of Children'] || null,
      region: data['Region'] || null
    },
    
    employment_data: {
      hire_date: parseDate(data['HireDate']),
      resign_date: parseDate(data['Resign Date']),
      confirm_date: parseDate(data['Confirm Date']),
      department: data['Department'] || null,
      section: data['Section'] || null,
      category: data['Category'] || null,
      cost_center: data['Cost Center'] || null,
      position: data['Position'] || data['Designation'] || null
    },
    
    compensation_data: {
      current_basic: parseFloat(data['Current Basic']) || null,
      mid_basic: parseFloat(data['Mid Basic']) || null,
      previous_basic: parseFloat(data['Previous Basic']) || null,
      payment_type: data['Payment Type'] || null,
      payment_frequency: data['Payment Frequency'] || null,
      payment_via: data['Payment Via'] || null,
      bank_code: data['Bank Code/ Branch'] || null,
      bank_account_no: data['Bank Account No'] || null
    },
    
    statutory_data: {
      epf_number: data['EPF No.'] || null,
      socso_number: data['Socso No.'] || null,
      income_tax_number: data['Income Tax No.'] || null,
      zakat_number: data['Zakat No.'] || null
    },
    
    raw_import_data: data,
    import_date: new Date(),
    data_source: 'hr2000'
  };
}

// Create table if needed
async function ensureTable() {
  console.log('📊 Checking hr2000_master table...');
  
  const { error } = await supabase
    .from('hr2000_master')
    .select('id')
    .limit(1);
  
  if (error && error.message.includes('does not exist')) {
    console.log('\n❌ Table does not exist!');
    console.log('Please create it in Supabase with the following SQL:\n');
    console.log(`CREATE TABLE hr2000_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  organization_id UUID,
  active BOOLEAN DEFAULT true,
  personal_data JSONB DEFAULT '{}',
  employment_data JSONB DEFAULT '{}',
  compensation_data JSONB DEFAULT '{}',
  statutory_data JSONB DEFAULT '{}',
  raw_import_data JSONB DEFAULT '{}',
  import_date TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  data_source TEXT DEFAULT 'hr2000'
);

CREATE INDEX idx_employee_id ON hr2000_master (employee_id);
CREATE INDEX idx_active ON hr2000_master (active);
CREATE INDEX idx_organization ON hr2000_master (organization_id);`);
    return false;
  }
  
  console.log('✅ Table exists\n');
  return true;
}

// Import single file
async function importFile(filePath) {
  const filename = path.basename(filePath);
  const filePrefix = filename.split('_')[0];
  const orgMapping = ORGANIZATION_MAPPINGS[filePrefix];
  
  console.log(`\n📁 Processing: ${filename}`);
  console.log(`  Organization: ${orgMapping ? orgMapping.name : 'Unknown'} (${filePrefix})`);
  
  try {
    // Read and parse file
    const content = fs.readFileSync(filePath, 'utf8');
    const employees = parseHR2000File(content, filePrefix);
    
    console.log(`  Found ${employees.length} employees`);
    
    // Transform data
    const transformedEmployees = employees
      .map(emp => transformToDBFormat(emp, orgMapping))
      .filter(emp => emp.full_name !== 'PENDING_UPDATE' && emp.full_name !== '');
    
    console.log(`  Valid employees: ${transformedEmployees.length}`);
    
    if (transformedEmployees.length === 0) {
      console.log('  ⚠️  No valid employees to import');
      return 0;
    }
    
    // Insert in batches
    const batchSize = 20;
    let inserted = 0;
    
    for (let i = 0; i < transformedEmployees.length; i += batchSize) {
      const batch = transformedEmployees.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from('hr2000_master')
        .upsert(batch, { onConflict: 'employee_id' })
        .select();
      
      if (error) {
        console.error(`  ❌ Batch error: ${error.message}`);
      } else {
        inserted += data.length;
        console.log(`  Progress: ${inserted}/${transformedEmployees.length}`);
      }
    }
    
    console.log(`  ✅ Successfully imported ${inserted} employees`);
    return inserted;
    
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return 0;
  }
}

// Import all files
async function importAll() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  
  console.log('🚀 THR HR2000 Import Tool\n');
  console.log('=' .repeat(50));
  
  // Setup
  await ensureOrganizationsExist();
  const tableReady = await ensureTable();
  
  if (!tableReady) {
    return;
  }
  
  // Get CSV files
  const files = fs.readdirSync(rawDataPath)
    .filter(f => f.endsWith('.csv'))
    .sort();
  
  console.log(`\nFound ${files.length} CSV files to process`);
  
  let totalImported = 0;
  const results = [];
  
  for (const file of files) {
    const count = await importFile(path.join(rawDataPath, file));
    totalImported += count;
    results.push({ file, count });
  }
  
  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 IMPORT SUMMARY\n');
  
  results.forEach(({ file, count }) => {
    console.log(`  ${file}: ${count} employees`);
  });
  
  console.log(`\n✅ Total imported: ${totalImported} employees`);
  
  // Verify database total
  const { count } = await supabase
    .from('hr2000_master')
    .select('*', { count: 'exact', head: true });
  
  console.log(`📊 Database total: ${count} employees`);
}

// Test parser
async function testParser(filePath) {
  const filename = path.basename(filePath);
  const filePrefix = filename.split('_')[0];
  
  console.log(`\n🔍 Testing parser on: ${filename}\n`);
  
  const content = fs.readFileSync(filePath, 'utf8');
  const employees = parseHR2000File(content, filePrefix);
  
  console.log(`Found ${employees.length} employees\n`);
  
  // Show first employee
  if (employees.length > 0) {
    console.log('First employee raw data:');
    console.log(JSON.stringify(employees[0], null, 2));
    
    const orgMapping = ORGANIZATION_MAPPINGS[filePrefix];
    const transformed = transformToDBFormat(employees[0], orgMapping);
    
    console.log('\nTransformed data:');
    console.log(JSON.stringify(transformed, null, 2));
  }
}

// Main CLI
async function main() {
  const command = process.argv[2];
  const filePath = process.argv[3];
  
  switch (command) {
    case 'test':
      if (!filePath) {
        console.error('Please provide a file path to test');
        process.exit(1);
      }
      await testParser(filePath);
      break;
      
    case 'file':
      if (!filePath) {
        console.error('Please provide a file path to import');
        process.exit(1);
      }
      await ensureOrganizationsExist();
      await ensureTable();
      await importFile(filePath);
      break;
      
    case 'all':
    default:
      await importAll();
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}