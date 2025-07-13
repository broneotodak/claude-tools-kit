#!/usr/bin/env node

/**
 * THR Comprehensive Import Tool
 * Merges data from both CSV and TXT files
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

const RAW_DATA_PATH = '/Users/broneotodak/Projects/THR/raw_data';

// Organization mappings
const ORGANIZATION_MAPPINGS = {
  'LTCM': { id: '7bf98516-0582-4b6c-8231-1f693e4da9b4', name: 'Lan Todak Consultation & Management' },
  'TTK': { id: '6e0cff12-3d6d-4dc2-8291-52cae49e734b', name: 'Tadika Todak Kids' },
  'SYSB': { id: '7ab604c6-e4d7-497f-860d-1a5bef1f8a65', name: 'Sygroup Sdn. Bhd.' },
  'TODAK': { id: '3dc956b8-e02e-4b44-abc9-8dcce9e8c93b', name: 'Todak Technologies Sdn. Bhd.' },
  'TTSB': { id: 'e1b5ddcb-fa8b-4f07-8af9-a33497c59e69', name: 'Todak Technology Sdn. Bhd.' },
  'UIUX': { id: '87f8bb5b-50a9-4dc6-8ac1-c83f45bb4cda', name: 'UI/UX Sdn. Bhd.' },
  'TCSB': { id: 'd9de9e23-b3fe-4f9e-8d95-d72c3fa4bf2f', name: 'Todak Culture Sdn. Bhd.' },
  'GT': { id: '21bba0d1-2eb1-404d-bd10-f0e5c12bfc3f', name: 'Green Todak Sdn. Bhd.' },
  'KKT': { id: 'f8b82065-88f3-48e6-8dd5-89b0feebee83', name: 'Kelab Kembara Todak' },
  'SBB': { id: '2c3e5c6d-7c40-41a3-baed-18cf1ac75e60', name: 'SYARIKAT BELIA BERJAYA' },
  '10C': { id: '01b1dd76-e88b-4767-843a-e7bb96bbeca0', name: '10Camp' },
  'HSB': { id: '75a2dc7f-5b6f-4f56-8e68-4b956a38d951', name: 'Hyleen Sdn. Bhd.' },
  'MH': { id: '2854f72c-cede-4f35-99f4-a62a44b87284', name: 'Muscle Hub' },
  'STSB': { id: '4cdfbcd6-d4fc-4797-94f7-c060fb4c7508', name: 'Sarcom Technology Sdn. Bhd.' }
};

// Parse CSV file with the specific HR2000 format
function parseCSVEmployee(content, filePrefix) {
  const lines = content.split('\n');
  const employees = [];
  let currentEmployee = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const parts = line.split(',').map(p => p.trim());
    
    // Check for Employee No. row
    if (parts[0] === 'Employee No.' && parts[3]) {
      if (currentEmployee) {
        employees.push(currentEmployee);
      }
      
      currentEmployee = {
        employee_no: parts[3],
        organization: filePrefix,
        data_source: 'csv',
        csv_data: {}
      };
      continue;
    }
    
    if (!currentEmployee) continue;
    
    // Parse field rows with specific column positions
    if (parts[0]) {
      const fieldName = parts[0];
      const value1 = parts[3] || '';
      const value2 = parts[4] || '';
      
      // Handle fields in first position
      if (value1 && value1 !== '/' && value1 !== '/ /') {
        const fieldKey = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        
        // Special handling for currency values
        if (fieldName.includes('Basic') && value2) {
          currentEmployee.csv_data[fieldKey] = value2.replace(/,/g, '');
        } else {
          currentEmployee.csv_data[fieldKey] = value1;
        }
      }
      
      // Handle fields in second position (column 5+)
      if (parts[5]) {
        const fieldName2 = parts[5];
        const value3 = parts[8] || '';
        
        if (value3 && value3 !== '/' && value3 !== '/ /') {
          const fieldKey2 = fieldName2.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          currentEmployee.csv_data[fieldKey2] = value3;
        }
      }
    }
  }
  
  if (currentEmployee) {
    employees.push(currentEmployee);
  }
  
  return employees;
}

// Parse TXT file with flexible extraction
function parseTXTEmployee(content, filePrefix) {
  const lines = content.split('\n');
  const employees = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for employee number pattern
    if (line.includes('Employee No.') && line.match(/[A-Z]+\d+/)) {
      const employee = {
        employee_no: null,
        organization: filePrefix,
        data_source: 'txt',
        txt_data: {},
        raw_text: []
      };
      
      // Extract employee number
      const empMatch = line.match(/Employee No\.\s+([A-Z]+\d+)/);
      if (empMatch) employee.employee_no = empMatch[1];
      
      // Extract data from next ~100 lines
      for (let j = i; j < Math.min(i + 100, lines.length); j++) {
        const dataLine = lines[j];
        employee.raw_text.push(dataLine);
        
        // Extract various fields using regex
        extractFieldData(dataLine, employee.txt_data);
      }
      
      if (employee.employee_no) {
        employees.push(employee);
      }
    }
  }
  
  return employees;
}

// Helper to extract field data from a line
function extractFieldData(line, data) {
  const patterns = [
    { pattern: /Name\s+([A-Z][A-Z\s/]+)(?=\s{2,}|$)/, field: 'name' },
    { pattern: /I\/C No\. \(New\)\s+(\d+)/, field: 'ic_new' },
    { pattern: /Nationality\s+(\w+)/, field: 'nationality' },
    { pattern: /Race\s+(\w+)/, field: 'race' },
    { pattern: /Religion\s+(\w+)/, field: 'religion' },
    { pattern: /Sex\s+(\w+)/, field: 'gender' },
    { pattern: /Birth Date\s+(\d{2}\/\d{2}\/\d{4})/, field: 'birth_date' },
    { pattern: /Marital Status\s+(\w+)/, field: 'marital_status' },
    { pattern: /No\. of Children\s+(\d+)/, field: 'children_count' },
    { pattern: /HireDate\s+(\d{2}\/\d{2}\/\d{4})/, field: 'hire_date' },
    { pattern: /Department\s+([^/]+?)(?=\s{2,}|$)/, field: 'department' },
    { pattern: /Bank Account No\s+(\d+)/, field: 'bank_account' },
    { pattern: /Current Basic\s+RM([\d,]+\.?\d*)/, field: 'current_basic' },
    { pattern: /Epf No\s+(\d+)/, field: 'epf_no' },
    { pattern: /SOCSO \/ KSPA No\s+(\S+)/, field: 'socso_no' },
    { pattern: /Income Tax No\s+(\S+)/, field: 'income_tax_no' },
    { pattern: /E-Mail\s+([^|]+)/, field: 'email' },
    { pattern: /Mobile\s+([\d-]+)/, field: 'mobile' },
    { pattern: /Home Address\s+(.+?)(?=\s{2,}|$)/, field: 'address' }
  ];
  
  patterns.forEach(({ pattern, field }) => {
    const match = line.match(pattern);
    if (match) {
      let value = match[1].trim();
      // Clean up currency values
      if (field === 'current_basic') {
        value = value.replace(/,/g, '');
      }
      // Don't overwrite if we already have a value
      if (!data[field] || data[field] === '/') {
        data[field] = value;
      }
    }
  });
}

// Merge employee data from CSV and TXT
function mergeEmployeeData(csvEmployees, txtEmployees) {
  const merged = new Map();
  
  // Start with CSV data
  csvEmployees.forEach(emp => {
    const key = `${emp.organization}_${emp.employee_no}`;
    merged.set(key, {
      employee_no: emp.employee_no,
      organization_code: emp.organization,
      organization_id: ORGANIZATION_MAPPINGS[emp.organization]?.id,
      
      // Basic fields from CSV
      name: emp.csv_data.name || emp.name,
      ic_no: emp.csv_data.new_ic_no || emp.csv_data.old_ic_no,
      email: emp.csv_data.email,
      mobile_no: emp.csv_data.mobile_no || emp.csv_data.mobile,
      department: emp.csv_data.department,
      designation: emp.csv_data.designation,
      hire_date: emp.csv_data.employment_date,
      
      // Store original data
      csv_data: emp.csv_data,
      txt_data: {},
      
      // Metadata
      import_source: 'csv',
      created_at: new Date().toISOString()
    });
  });
  
  // Enhance with TXT data
  txtEmployees.forEach(emp => {
    const key = `${emp.organization}_${emp.employee_no}`;
    const existing = merged.get(key);
    
    if (existing) {
      // Merge TXT data into existing record
      existing.txt_data = emp.txt_data;
      existing.import_source = 'both';
      
      // Fill in missing data from TXT
      if (!existing.name && emp.txt_data.name) existing.name = emp.txt_data.name;
      if (!existing.ic_no && emp.txt_data.ic_new) existing.ic_no = emp.txt_data.ic_new;
      if (!existing.email && emp.txt_data.email) existing.email = emp.txt_data.email;
      if (!existing.mobile_no && emp.txt_data.mobile) existing.mobile_no = emp.txt_data.mobile;
      if (!existing.department && emp.txt_data.department) existing.department = emp.txt_data.department;
      if (!existing.hire_date && emp.txt_data.hire_date) existing.hire_date = emp.txt_data.hire_date;
      
      // Additional fields only in TXT
      existing.nationality = emp.txt_data.nationality;
      existing.race = emp.txt_data.race;
      existing.religion = emp.txt_data.religion;
      existing.gender = emp.txt_data.gender;
      existing.marital_status = emp.txt_data.marital_status;
      existing.birth_date = emp.txt_data.birth_date;
      existing.children_count = emp.txt_data.children_count;
      existing.current_basic = emp.txt_data.current_basic;
      existing.bank_account = emp.txt_data.bank_account;
      existing.epf_no = emp.txt_data.epf_no;
      existing.socso_no = emp.txt_data.socso_no;
      existing.income_tax_no = emp.txt_data.income_tax_no;
      existing.address = emp.txt_data.address;
      
    } else {
      // TXT-only record
      merged.set(key, {
        employee_no: emp.employee_no,
        organization_code: emp.organization,
        organization_id: ORGANIZATION_MAPPINGS[emp.organization]?.id,
        
        // Fields from TXT
        name: emp.txt_data.name,
        ic_no: emp.txt_data.ic_new,
        email: emp.txt_data.email,
        mobile_no: emp.txt_data.mobile,
        department: emp.txt_data.department,
        hire_date: emp.txt_data.hire_date,
        
        // Additional TXT fields
        nationality: emp.txt_data.nationality,
        race: emp.txt_data.race,
        religion: emp.txt_data.religion,
        gender: emp.txt_data.gender,
        marital_status: emp.txt_data.marital_status,
        birth_date: emp.txt_data.birth_date,
        children_count: emp.txt_data.children_count,
        current_basic: emp.txt_data.current_basic,
        bank_account: emp.txt_data.bank_account,
        epf_no: emp.txt_data.epf_no,
        socso_no: emp.txt_data.socso_no,
        income_tax_no: emp.txt_data.income_tax_no,
        address: emp.txt_data.address,
        
        // Store original data
        csv_data: {},
        txt_data: emp.txt_data,
        
        // Metadata
        import_source: 'txt',
        created_at: new Date().toISOString()
      });
    }
  });
  
  return Array.from(merged.values());
}

async function importAllData() {
  console.log('🚀 THR Comprehensive Import Tool\n');
  console.log('=' .repeat(60));
  
  const files = fs.readdirSync(RAW_DATA_PATH);
  const csvFiles = files.filter(f => f.endsWith('.csv'));
  const txtFiles = files.filter(f => f.endsWith('.txt'));
  
  console.log(`\nFound ${csvFiles.length} CSV files and ${txtFiles.length} TXT files\n`);
  
  const allEmployees = [];
  
  // Process each organization
  for (const csvFile of csvFiles) {
    const org = csvFile.split('_')[0];
    const txtFile = csvFile.replace('.csv', '.txt');
    
    console.log(`\nProcessing ${org}...`);
    
    // Parse CSV
    const csvContent = fs.readFileSync(path.join(RAW_DATA_PATH, csvFile), 'utf8');
    const csvEmployees = parseCSVEmployee(csvContent, org);
    console.log(`  CSV: ${csvEmployees.length} employees`);
    
    // Parse TXT
    const txtContent = fs.readFileSync(path.join(RAW_DATA_PATH, txtFile), 'utf8');
    const txtEmployees = parseTXTEmployee(txtContent, org);
    console.log(`  TXT: ${txtEmployees.length} employees`);
    
    // Merge data
    const merged = mergeEmployeeData(csvEmployees, txtEmployees);
    console.log(`  Merged: ${merged.length} total employees`);
    
    allEmployees.push(...merged);
  }
  
  console.log(`\n\nTotal employees to import: ${allEmployees.length}`);
  
  // Analyze data completeness
  console.log('\n📊 Data Completeness:');
  const fields = ['name', 'ic_no', 'email', 'mobile_no', 'department', 'hire_date', 
                  'bank_account', 'epf_no', 'address', 'gender', 'nationality'];
  
  fields.forEach(field => {
    const count = allEmployees.filter(emp => emp[field]).length;
    const percent = ((count / allEmployees.length) * 100).toFixed(1);
    console.log(`  ${field.padEnd(15)}: ${count}/${allEmployees.length} (${percent}%)`);
  });
  
  // Find duplicates across organizations
  console.log('\n🔍 Duplicate Analysis:');
  const byIC = {};
  allEmployees.forEach(emp => {
    if (emp.ic_no) {
      if (!byIC[emp.ic_no]) byIC[emp.ic_no] = [];
      byIC[emp.ic_no].push(emp);
    }
  });
  
  const duplicates = Object.entries(byIC).filter(([ic, emps]) => emps.length > 1);
  console.log(`Found ${duplicates.length} people in multiple organizations`);
  
  // Ask for confirmation
  console.log('\n' + '=' .repeat(60));
  console.log('\n⚠️  Ready to import data to master_hr2000 table');
  console.log('This will CLEAR existing data and import fresh');
  console.log('\nProceed? (yes/no): ');
  
  // For now, just save to a file
  const outputFile = '/Users/broneotodak/Projects/claude-tools-kit/thr-import-data.json';
  fs.writeFileSync(outputFile, JSON.stringify(allEmployees, null, 2));
  console.log(`\n📁 Data saved to: ${outputFile}`);
  console.log('Review the data before importing to database');
}

// Main execution
async function main() {
  try {
    await importAllData();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}