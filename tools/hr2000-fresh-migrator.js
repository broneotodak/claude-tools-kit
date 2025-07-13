#!/usr/bin/env node

/**
 * HR2000 Fresh Migration Tool
 * Migrates raw HR data into clean JSONB structure
 */

const { createClient } = require('@supabase/supabase-js');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { ORGANIZATION_MAPPINGS } = require('./thr-organization-mapper');

// Use ATLAS database for fresh start
const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Field mappings for different data categories
const FIELD_MAPPINGS = {
  core: ['employee_id', 'full_name', 'email', 'organization_id', 'active'],
  
  personal: [
    'ic_number_new', 'ic_number_old', 'passport_number',
    'birth_date', 'birth_place', 'gender', 'marital_status',
    'nationality', 'religion', 'race', 'blood_type',
    'phone', 'personal_email', 'current_address', 'permanent_address'
  ],

  spouse: [
    'spouse_name', 'spouse_ic', 'spouse_passport',
    'spouse_dob', 'spouse_occupation', 'spouse_employer',
    'spouse_income', 'spouse_phone', 'spouse_email',
    'spouse_address', 'spouse_tax_number', 'spouse_tax_branch'
  ],
  
  employment: [
    'designation', 'department', 'section', 'unit', 'grade',
    'join_date', 'confirmation_date', 'resignation_date',
    'employment_status', 'employee_category', 'work_location'
  ],
  
  compensation: [
    'basic_salary', 'gross_salary', 'net_salary',
    'allowances', 'deductions', 'overtime_rate',
    'payment_method', 'bank_name', 'bank_account'
  ],
  
  statutory: [
    'epf_number', 'epf_rate', 'socso_number', 'socso_type',
    'income_tax_number', 'income_tax_branch', 'eis_contribution',
    'hrdf_contribution', 'zakat_contribution'
  ]
};

// Clean and transform data
function transformEmployeeData(rawData, filePrefix) {
  const transformed = {
    // Extract core fields
    employee_id: rawData.employee_no || rawData.employee_id || rawData.staff_id,
    full_name: cleanName(rawData.name || rawData.full_name || rawData.employee_name),
    email: cleanEmail(rawData.email || rawData.work_email),
    organization_id: mapOrganization(rawData.company || rawData.organization || rawData.branch, filePrefix),
    active: determineActiveStatus(rawData),

    // Extract spouse core fields if available
    spouse_name: rawData.spouse_name || rawData.spouse_full_name,
    spouse_ic: rawData.spouse_ic || rawData.spouse_ic_number || rawData.spouse_nric,
    
    // Group other data into JSONB fields
    personal_data: {},
    employment_data: {},
    compensation_data: {},
    statutory_data: {},
    spouse_data: {},
    raw_import_data: rawData // Keep original for reference
  };
  
  // Map fields to appropriate JSONB objects
  Object.entries(rawData).forEach(([key, value]) => {
    if (value === null || value === '' || value === 'NULL') return;
    
    const cleanKey = key.toLowerCase().replace(/\s+/g, '_');
    
    if (FIELD_MAPPINGS.personal.some(f => cleanKey.includes(f))) {
      transformed.personal_data[cleanKey] = cleanValue(value);
    } else if (FIELD_MAPPINGS.employment.some(f => cleanKey.includes(f))) {
      transformed.employment_data[cleanKey] = cleanValue(value);
    } else if (FIELD_MAPPINGS.compensation.some(f => cleanKey.includes(f))) {
      transformed.compensation_data[cleanKey] = cleanValue(value);
    } else if (FIELD_MAPPINGS.statutory.some(f => cleanKey.includes(f))) {
      transformed.statutory_data[cleanKey] = cleanValue(value);
    } else if (FIELD_MAPPINGS.spouse.some(f => cleanKey.includes(f))) {
      transformed.spouse_data[cleanKey] = cleanValue(value);
    }
  });
  
  return transformed;
}

// Helper functions
function cleanName(name) {
  if (!name) return 'PENDING_UPDATE';
  return name.trim().toUpperCase();
}

function cleanEmail(email) {
  if (!email) return null;
  email = email.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function cleanValue(value) {
  if (typeof value === 'string') {
    value = value.trim();
    if (value === 'NULL' || value === 'N/A' || value === '-') return null;
  }
  return value;
}

function determineActiveStatus(data) {
  if (data.status) {
    return ['active', 'employed', 'working'].includes(data.status.toLowerCase());
  }
  if (data.resignation_date || data.termination_date) {
    return false;
  }
  return true;
}

function mapOrganization(orgName, filePrefix) {
  // First try to use file prefix for accurate mapping
  if (filePrefix && ORGANIZATION_MAPPINGS[filePrefix]) {
    return ORGANIZATION_MAPPINGS[filePrefix].id;
  }
  
  // Fallback to name matching if no prefix
  if (!orgName) return null;
  const normalized = orgName.toLowerCase();
  
  // Try to match against known organization names
  for (const [code, org] of Object.entries(ORGANIZATION_MAPPINGS)) {
    if (normalized.includes(org.name.toLowerCase()) || 
        org.name.toLowerCase().includes(normalized)) {
      return org.id;
    }
  }
  
  return null; // Unknown organization
}

// Migration functions
async function createMasterTable() {
  console.log('📊 Creating hr2000_master table...\n');
  
  const { error } = await supabase.rpc('create_hr2000_master_table', {
    sql: `
      CREATE TABLE IF NOT EXISTS hr2000_master (
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
        spouse_data JSONB DEFAULT '{}',
        raw_import_data JSONB DEFAULT '{}',
        import_date TIMESTAMPTZ DEFAULT NOW(),
        last_updated TIMESTAMPTZ DEFAULT NOW(),
        data_source TEXT DEFAULT 'hr2000'
      );
      
      CREATE INDEX IF NOT EXISTS idx_employee_id ON hr2000_master (employee_id);
      CREATE INDEX IF NOT EXISTS idx_active ON hr2000_master (active);
      CREATE INDEX IF NOT EXISTS idx_organization ON hr2000_master (organization_id);
      CREATE INDEX IF NOT EXISTS idx_personal_ic ON hr2000_master ((personal_data->>'ic_number_new'));
      CREATE INDEX IF NOT EXISTS idx_employment_dept ON hr2000_master ((employment_data->>'department'));
      CREATE INDEX IF NOT EXISTS idx_spouse_ic ON hr2000_master ((spouse_data->>'spouse_ic'));
      CREATE INDEX IF NOT EXISTS idx_spouse_name ON hr2000_master ((spouse_data->>'spouse_name'));
    `
  });
  
  if (error) {
    console.log('Note: Table might already exist, continuing...');
  }
}

async function migrateFromCSV(csvPath) {
  console.log(`📁 Migrating from: ${csvPath}\n`);
  
  // Extract organization prefix from filename
  const filename = path.basename(csvPath);
  const filePrefix = filename.split('_')[0];
  console.log(`  Organization code: ${filePrefix}`);
  
  const employees = [];
  let processed = 0;
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        const transformed = transformEmployeeData(row, filePrefix);
        if (transformed.employee_id) {
          employees.push(transformed);
          processed++;
          
          if (processed % 100 === 0) {
            console.log(`  Processed ${processed} employees...`);
          }
        }
      })
      .on('end', async () => {
        console.log(`\n✅ Read ${employees.length} employees from CSV`);
        
        // Insert in batches
        const batchSize = 50;
        let inserted = 0;
        
        for (let i = 0; i < employees.length; i += batchSize) {
          const batch = employees.slice(i, i + batchSize);
          
          const { error } = await supabase
            .from('hr2000_master')
            .upsert(batch, { onConflict: 'employee_id' });
            
          if (error) {
            console.error(`❌ Error inserting batch: ${error.message}`);
          } else {
            inserted += batch.length;
            console.log(`  Inserted ${inserted}/${employees.length}`);
          }
        }
        
        resolve(inserted);
      })
      .on('error', reject);
  });
}

async function analyzeImportedData() {
  console.log('\n📊 Analyzing imported data...\n');
  
  const { data: stats } = await supabase
    .from('hr2000_master')
    .select('active')
    .order('import_date', { ascending: false });
    
  const active = stats.filter(s => s.active).length;
  const inactive = stats.length - active;
  
  console.log(`Total employees: ${stats.length}`);
  console.log(`Active: ${active} (${(active/stats.length*100).toFixed(1)}%)`);
  console.log(`Inactive: ${inactive}`);
  
  // Sample data quality
  const { data: sample } = await supabase
    .from('hr2000_master')
    .select('*')
    .limit(5);
    
  console.log('\nSample employee structure:');
  if (sample && sample[0]) {
    console.log('Personal data fields:', Object.keys(sample[0].personal_data || {}).join(', '));
    console.log('Employment data fields:', Object.keys(sample[0].employment_data || {}).join(', '));
    console.log('Spouse data fields:', Object.keys(sample[0].spouse_data || {}).join(', '));

    // Validate spouse data quality
    const spouseDataQuality = sample.map(emp => ({
      hasSpouseData: Object.keys(emp.spouse_data || {}).length > 0,
      hasSpouseIC: Boolean(emp.spouse_data?.spouse_ic),
      hasSpouseName: Boolean(emp.spouse_data?.spouse_name)
    }));

    const spouseStats = spouseDataQuality.reduce((acc, curr) => ({
      total: acc.total + 1,
      withSpouseData: acc.withSpouseData + (curr.hasSpouseData ? 1 : 0),
      withSpouseIC: acc.withSpouseIC + (curr.hasSpouseIC ? 1 : 0),
      withSpouseName: acc.withSpouseName + (curr.hasSpouseName ? 1 : 0)
    }), { total: 0, withSpouseData: 0, withSpouseIC: 0, withSpouseName: 0 });

    console.log('\nSpouse Data Quality (Sample):');
    console.log(`Records with spouse data: ${spouseStats.withSpouseData}/${spouseStats.total}`);
    console.log(`Records with spouse IC: ${spouseStats.withSpouseIC}/${spouseStats.total}`);
    console.log(`Records with spouse name: ${spouseStats.withSpouseName}/${spouseStats.total}`);
  }
}

// CLI
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  try {
    switch (command) {
      case 'setup':
        await createMasterTable();
        console.log('✅ Master table created');
        break;
        
      case 'import':
        if (!arg) {
          console.error('Please provide CSV path');
          process.exit(1);
        }
        const count = await migrateFromCSV(arg);
        console.log(`\n✅ Migration complete: ${count} employees imported`);
        await analyzeImportedData();
        break;
        
      case 'analyze':
        await analyzeImportedData();
        break;
        
      case 'clean':
        console.log('🧹 Cleaning THR_neo database (except thr_atlas tables)...');
        // Add cleaning logic here
        break;
        
      default:
        console.log('HR2000 Fresh Migration Tool\n');
        console.log('Commands:');
        console.log('  setup                - Create master table with JSONB structure');
        console.log('  import <csv>         - Import HR2000 data from CSV');
        console.log('  analyze              - Analyze imported data');
        console.log('  clean                - Clean existing data (keep thr_atlas)');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  transformEmployeeData,
  migrateFromCSV,
  createMasterTable
};