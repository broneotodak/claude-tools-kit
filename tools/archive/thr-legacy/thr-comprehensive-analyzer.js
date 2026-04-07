#!/usr/bin/env node

/**
 * THR Comprehensive Data Analyzer
 * Analyzes both CSV and TXT files to understand data complexity
 */

const fs = require('fs');
const path = require('path');

const RAW_DATA_PATH = '/Users/broneotodak/Projects/THR/raw_data';

// Parse TXT file format
function parseTxtEmployee(lines, startIdx) {
  const employee = {
    personal: {},
    employment: {},
    payment: {},
    statutory: {},
    spouse: {},
    allowances: [],
    raw_text: lines.slice(startIdx, startIdx + 120).join('\n')
  };
  
  // Helper to extract value after label
  const extractValue = (line, label) => {
    const idx = line.indexOf(label);
    if (idx === -1) return null;
    const afterLabel = line.substring(idx + label.length).trim();
    // Handle cases where there are two fields on same line
    const nextFieldMatch = afterLabel.match(/^([^\s].*?)(?:\s{2,}[A-Z]|$)/);
    return nextFieldMatch ? nextFieldMatch[1].trim() : afterLabel.split(/\s{2,}/)[0].trim();
  };
  
  // Parse line by line
  for (let i = startIdx; i < Math.min(startIdx + 120, lines.length); i++) {
    const line = lines[i];
    
    // Employee number
    if (line.includes('Employee No.')) {
      employee.employee_no = extractValue(line, 'Employee No.');
    }
    
    // Personal details
    if (line.includes('Name') && !line.includes('Spouse')) {
      employee.personal.name = extractValue(line, 'Name');
    }
    if (line.includes('I/C No. (New)')) {
      employee.personal.ic_new = extractValue(line, 'I/C No. (New)');
      employee.personal.nationality = extractValue(line, 'Nationality') || extractValue(lines[i], 'Nationality');
    }
    if (line.includes('I/C No. (OLD)')) {
      employee.personal.ic_old = extractValue(line, 'I/C No. (OLD)');
      employee.personal.race = extractValue(line, 'Race') || extractValue(lines[i], 'Race');
    }
    if (line.includes('Date of Birth') || line.includes('Birth Date')) {
      employee.personal.birth_date = extractValue(line, line.includes('Date of Birth') ? 'Date of Birth' : 'Birth Date');
    }
    
    // Employment details
    if (line.includes('HireDate') || line.includes('Employment Date')) {
      employee.employment.hire_date = extractValue(line, line.includes('HireDate') ? 'HireDate' : 'Employment Date');
    }
    if (line.includes('Department')) {
      employee.employment.department = extractValue(line, 'Department');
    }
    if (line.includes('Designation')) {
      employee.employment.designation = extractValue(line, 'Designation');
    }
    if (line.includes('Cost Center')) {
      employee.employment.cost_center = extractValue(line, 'Cost Center');
    }
    
    // Payment details
    if (line.includes('Current Basic')) {
      const basicLine = lines[i+1] || '';
      const salary = basicLine.match(/RM[\s,\d.]+/);
      employee.payment.current_basic = salary ? salary[0] : null;
    }
    if (line.includes('Bank Account No')) {
      employee.payment.bank_account = extractValue(line, 'Bank Account No');
    }
    if (line.includes('Bank Code')) {
      employee.payment.bank_code = extractValue(line, 'Bank Code/ Branch');
    }
    
    // Address
    if (line.includes('Address') && !line.includes('Email')) {
      // Address might be on next lines
      employee.personal.address = extractValue(line, 'Address');
      if (i + 1 < lines.length && !lines[i + 1].includes(':')) {
        employee.personal.address = (employee.personal.address || '') + ' ' + lines[i + 1].trim();
      }
    }
    if (line.includes('City')) {
      employee.personal.city = extractValue(line, 'City');
      employee.personal.state = extractValue(line, 'State');
    }
    if (line.includes('Postcode')) {
      employee.personal.postcode = extractValue(line, 'Postcode');
      employee.personal.country = extractValue(line, 'Country');
    }
    
    // Contact
    if (line.includes('Mobile') || line.includes('H/Phone')) {
      employee.personal.mobile = extractValue(line, line.includes('Mobile') ? 'Mobile' : 'H/Phone');
    }
    if (line.includes('E-Mail') || line.includes('Email')) {
      employee.personal.email = extractValue(line, line.includes('E-Mail') ? 'E-Mail' : 'Email');
    }
    
    // Spouse details
    if (line.includes('SPOUSE DETAIL')) {
      // Look for spouse info in next lines
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].includes('Name') && !employee.spouse.name) {
          employee.spouse.name = extractValue(lines[j], 'Name');
        }
        if (lines[j].includes('I/C No')) {
          employee.spouse.ic = extractValue(lines[j], 'I/C No (Old/ New)') || extractValue(lines[j], 'I/C No');
        }
      }
    }
    
    // Fixed Allowances
    if (line.includes('Fixed Allowance')) {
      // Parse allowance table
      for (let j = i + 2; j < Math.min(i + 20, lines.length); j++) {
        const allowLine = lines[j];
        const match = allowLine.match(/^\d+\s+(.+?)\s+([\d,.]+)\s+/);
        if (match) {
          employee.allowances.push({
            description: match[1].trim(),
            amount: match[2]
          });
        }
      }
    }
  }
  
  return employee;
}

// Parse all TXT files
async function analyzeTxtFiles() {
  const allEmployees = [];
  const files = fs.readdirSync(RAW_DATA_PATH).filter(f => f.endsWith('.txt'));
  
  console.log('📄 Parsing TXT files...\n');
  
  for (const file of files) {
    const org = file.split('_')[0];
    const content = fs.readFileSync(path.join(RAW_DATA_PATH, file), 'utf8');
    const lines = content.split('\n');
    
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Employee No.') && lines[i].match(/[A-Z]+\d+/)) {
        const employee = parseTxtEmployee(lines, i);
        employee.organization = org;
        employee.source_file = file;
        allEmployees.push(employee);
        count++;
      }
    }
    
    console.log(`  ${file}: ${count} employees`);
  }
  
  return allEmployees;
}

// Analyze duplicates and conflicts
function analyzeDataIssues(employees) {
  console.log('\n\n🔍 DATA ANALYSIS RESULTS\n');
  console.log('=' .repeat(60));
  
  // 1. Check for duplicate employees across organizations
  console.log('\n1. DUPLICATE EMPLOYEES (by IC Number):\n');
  
  const byIC = {};
  employees.forEach(emp => {
    const ic = emp.personal.ic_new || emp.personal.ic_old;
    if (ic && ic !== '/' && ic !== '') {
      if (!byIC[ic]) byIC[ic] = [];
      byIC[ic].push(emp);
    }
  });
  
  const duplicates = Object.entries(byIC).filter(([ic, emps]) => emps.length > 1);
  
  if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} people in multiple organizations:\n`);
    duplicates.slice(0, 10).forEach(([ic, emps]) => {
      console.log(`IC: ${ic}`);
      emps.forEach(emp => {
        console.log(`  - ${emp.organization}: ${emp.employee_no} - ${emp.personal.name}`);
        if (emp.personal.email) console.log(`    Email: ${emp.personal.email}`);
      });
      console.log('');
    });
    
    if (duplicates.length > 10) {
      console.log(`... and ${duplicates.length - 10} more duplicates\n`);
    }
  } else {
    console.log('No duplicates found\n');
  }
  
  // 2. Check for multiple emails
  console.log('\n2. EMPLOYEES WITH MULTIPLE EMAILS:\n');
  
  const multipleEmails = employees.filter(emp => {
    const email = emp.personal.email;
    return email && email.includes('|');
  });
  
  if (multipleEmails.length > 0) {
    console.log(`Found ${multipleEmails.length} employees with multiple emails:\n`);
    multipleEmails.slice(0, 5).forEach(emp => {
      console.log(`${emp.organization} - ${emp.employee_no}: ${emp.personal.email}`);
    });
  } else {
    console.log('No multiple emails found\n');
  }
  
  // 3. Data completeness
  console.log('\n3. DATA COMPLETENESS:\n');
  
  const fields = {
    'Name': emp => emp.personal.name,
    'IC Number': emp => emp.personal.ic_new || emp.personal.ic_old,
    'Email': emp => emp.personal.email,
    'Mobile': emp => emp.personal.mobile,
    'Address': emp => emp.personal.address,
    'City': emp => emp.personal.city,
    'Bank Account': emp => emp.payment.bank_account,
    'Department': emp => emp.employment.department,
    'Hire Date': emp => emp.employment.hire_date,
    'Spouse Name': emp => emp.spouse.name,
    'Allowances': emp => emp.allowances.length > 0
  };
  
  console.log('Field Completeness:');
  Object.entries(fields).forEach(([field, getter]) => {
    const count = employees.filter(emp => {
      const value = getter(emp);
      return value && value !== '/' && value !== '';
    }).length;
    const percent = ((count / employees.length) * 100).toFixed(1);
    console.log(`  ${field.padEnd(15)}: ${count}/${employees.length} (${percent}%)`);
  });
  
  // 4. Sample complex data
  console.log('\n\n4. SAMPLE COMPLEX DATA:\n');
  
  // Find employee with most complete data
  const scored = employees.map(emp => {
    let score = 0;
    Object.values(fields).forEach(getter => {
      if (getter(emp)) score++;
    });
    return { emp, score };
  }).sort((a, b) => b.score - a.score);
  
  if (scored.length > 0) {
    const best = scored[0].emp;
    console.log('Most complete employee record:');
    console.log(JSON.stringify({
      employee_no: best.employee_no,
      organization: best.organization,
      personal: best.personal,
      employment: best.employment,
      payment: best.payment,
      spouse: best.spouse,
      allowances: best.allowances
    }, null, 2));
  }
}

// Recommend schema changes
function recommendSchema(employees) {
  console.log('\n\n📋 SCHEMA RECOMMENDATIONS:\n');
  console.log('=' .repeat(60));
  
  console.log('\n1. JSONB Columns Recommended:');
  console.log('  • personal_details - For address, multiple contacts, etc.');
  console.log('  • employment_details - For department, cost center, designations');
  console.log('  • payment_details - For bank info, salary history');
  console.log('  • allowances_deductions - Array of allowances/deductions');
  console.log('  • spouse_details - Spouse information');
  console.log('  • raw_import_data - Preserve original data');
  
  console.log('\n2. Handling Duplicates:');
  console.log('  • Create employee_profiles table (one person)');
  console.log('  • Create employee_assignments table (person + org + period)');
  console.log('  • Link by IC number or unique person ID');
  
  console.log('\n3. Proposed Structure:');
  console.log(`
-- Master employee profiles (one per person)
CREATE TABLE employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ic_number TEXT UNIQUE,
  full_name TEXT,
  personal_data JSONB, -- addresses, contacts, etc
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employee assignments (multiple per person)
CREATE TABLE employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES employee_profiles(id),
  employee_no TEXT NOT NULL,
  organization_id UUID,
  employment_data JSONB, -- department, designation, dates
  payment_data JSONB, -- salary, bank details
  allowances JSONB[], -- array of allowances
  active BOOLEAN DEFAULT true,
  start_date DATE,
  end_date DATE,
  UNIQUE(employee_no, organization_id)
);
  `);
}

async function main() {
  try {
    console.log('🚀 THR Comprehensive Data Analyzer\n');
    console.log('=' .repeat(60));
    
    const employees = await analyzeTxtFiles();
    console.log(`\nTotal employees parsed: ${employees.length}`);
    
    analyzeDataIssues(employees);
    recommendSchema(employees);
    
    console.log('\n\n✅ Analysis complete!');
    console.log('\n⚠️  DO NOT import until we decide on the schema!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}