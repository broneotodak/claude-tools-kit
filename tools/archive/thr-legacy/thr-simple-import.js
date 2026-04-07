#!/usr/bin/env node

/**
 * THR Simple Import Tool
 * Imports HR2000 CSV files without external dependencies
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

// Parse CSV manually
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length === 0) return [];
  
  // Parse headers
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  
  // Parse data rows
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    data.push(row);
  }
  
  return data;
}

// Transform employee data
function transformEmployee(row, filePrefix) {
  const orgMapping = ORGANIZATION_MAPPINGS[filePrefix];
  
  return {
    employee_id: row.employee_no || row.employee_id || row.staff_id || `${filePrefix}_${Date.now()}`,
    full_name: (row.name || row.full_name || row.employee_name || 'PENDING_UPDATE').trim().toUpperCase(),
    email: row.email || row.work_email || null,
    organization_id: orgMapping ? orgMapping.id : null,
    active: !row.resignation_date && !row.termination_date,
    
    personal_data: {
      ic_number_new: row.ic_number_new || row.ic_new || null,
      ic_number_old: row.ic_number_old || row.ic_old || null,
      phone: row.phone || row.mobile || null,
      gender: row.gender || null,
      birth_date: row.birth_date || row.dob || null
    },
    
    employment_data: {
      department: row.department || null,
      designation: row.designation || row.position || null,
      join_date: row.join_date || row.start_date || null,
      employee_category: row.employee_category || row.category || null
    },
    
    compensation_data: {
      basic_salary: row.basic_salary || row.salary || null,
      bank_name: row.bank_name || null,
      bank_account: row.bank_account || null
    },
    
    statutory_data: {
      epf_number: row.epf_number || row.epf || null,
      socso_number: row.socso_number || row.socso || null,
      income_tax_number: row.income_tax_number || row.tax_number || null
    },
    
    raw_import_data: row,
    import_date: new Date(),
    data_source: 'hr2000'
  };
}

// Create table
async function createTable() {
  console.log('📊 Setting up hr2000_master table...\n');
  
  // Check if table exists by trying to query it
  const { error: checkError } = await supabase
    .from('hr2000_master')
    .select('id')
    .limit(1);
  
  if (checkError && checkError.message.includes('does not exist')) {
    console.log('Table does not exist. Please create it manually in Supabase with this structure:');
    console.log(`
CREATE TABLE hr2000_master (
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
CREATE INDEX idx_organization ON hr2000_master (organization_id);
    `);
    return false;
  }
  
  console.log('✅ Table exists or was created\n');
  return true;
}

// Import single file
async function importFile(filePath) {
  const filename = path.basename(filePath);
  const filePrefix = filename.split('_')[0];
  
  console.log(`\n📁 Processing: ${filename}`);
  console.log(`  Organization: ${filePrefix}`);
  
  try {
    // Read file
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = parseCSV(content);
    
    console.log(`  Found ${rows.length} rows`);
    
    // Transform data
    const employees = rows
      .map(row => transformEmployee(row, filePrefix))
      .filter(emp => emp.employee_id && emp.full_name !== 'PENDING_UPDATE');
    
    console.log(`  Valid employees: ${employees.length}`);
    
    // Insert in batches
    const batchSize = 50;
    let inserted = 0;
    
    for (let i = 0; i < employees.length; i += batchSize) {
      const batch = employees.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('hr2000_master')
        .upsert(batch, { onConflict: 'employee_id' });
      
      if (error) {
        console.error(`  ❌ Error: ${error.message}`);
      } else {
        inserted += batch.length;
        console.log(`  Progress: ${inserted}/${employees.length}`);
      }
    }
    
    console.log(`  ✅ Imported ${inserted} employees`);
    return inserted;
    
  } catch (error) {
    console.error(`  ❌ Error reading file: ${error.message}`);
    return 0;
  }
}

// Import all files
async function importAll() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  
  console.log('🚀 THR Simple Import Tool\n');
  
  // Setup
  await ensureOrganizationsExist();
  const tableReady = await createTable();
  
  if (!tableReady) {
    console.log('\nPlease create the table first, then run this tool again.');
    return;
  }
  
  // Get CSV files
  const files = fs.readdirSync(rawDataPath)
    .filter(f => f.endsWith('.csv'))
    .sort();
  
  console.log(`Found ${files.length} CSV files\n`);
  
  let total = 0;
  for (const file of files) {
    const count = await importFile(path.join(rawDataPath, file));
    total += count;
  }
  
  console.log(`\n✅ Total imported: ${total} employees`);
  
  // Verify
  const { count } = await supabase
    .from('hr2000_master')
    .select('*', { count: 'exact', head: true });
  
  console.log(`📊 Database total: ${count} employees`);
}

// Main
async function main() {
  const command = process.argv[2];
  
  if (command === 'file' && process.argv[3]) {
    const filePath = process.argv[3];
    await ensureOrganizationsExist();
    await createTable();
    await importFile(filePath);
  } else {
    await importAll();
  }
}

if (require.main === module) {
  main().catch(console.error);
}