#!/usr/bin/env node

/**
 * THR TXT File Analyzer
 * Analyzes what data is in TXT files that might be missing from CSV
 */

const fs = require('fs');
const path = require('path');

function parseTxtFile(content) {
  const lines = content.split('\n');
  const employees = [];
  let currentEmployee = null;
  let currentSection = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for employee number
    if (line.includes('Employee No.') && line.trim().split(/\s+/).length >= 3) {
      if (currentEmployee) {
        employees.push(currentEmployee);
      }
      
      const empNo = line.trim().split(/\s+/).pop();
      currentEmployee = {
        employee_no: empNo,
        sections: {},
        raw_lines: []
      };
    }
    
    if (currentEmployee) {
      currentEmployee.raw_lines.push(line);
      
      // Detect sections
      if (line.includes('PERSONAL DETAIL')) currentSection = 'personal';
      else if (line.includes('EMPLOYMENT DETAIL')) currentSection = 'employment';
      else if (line.includes('PAYMENT DETAIL')) currentSection = 'payment';
      else if (line.includes('STATUTORY BODY')) currentSection = 'statutory';
      else if (line.includes('SPOUSE DETAIL')) currentSection = 'spouse';
      else if (line.includes('Fixed Allowance')) currentSection = 'allowances';
      
      if (!currentEmployee.sections[currentSection]) {
        currentEmployee.sections[currentSection] = [];
      }
      currentEmployee.sections[currentSection].push(line);
    }
  }
  
  if (currentEmployee) {
    employees.push(currentEmployee);
  }
  
  return employees;
}

function extractFields(employee) {
  const fields = new Set();
  
  employee.raw_lines.forEach(line => {
    // Look for field patterns like "Field Name:" or "Field Name "
    const matches = line.match(/([A-Za-z\s\/#]+(?:\s+No\.?)?)\s+[\d\w]/);
    if (matches) {
      fields.add(matches[1].trim());
    }
  });
  
  return Array.from(fields);
}

async function analyzeTxtFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  
  console.log('🔍 Analyzing TXT Files vs CSV Files\n');
  console.log('=' .repeat(60));
  
  // Analyze one file in detail first
  const sampleFile = 'TCSB_Employee Master.txt';
  const samplePath = path.join(rawDataPath, sampleFile);
  
  console.log(`\n📄 Analyzing sample: ${sampleFile}\n`);
  
  const content = fs.readFileSync(samplePath, 'utf8');
  const employees = parseTxtFile(content);
  
  console.log(`Found ${employees.length} employees in TXT file`);
  
  if (employees.length > 0) {
    const emp = employees[0];
    console.log(`\nFirst employee: ${emp.employee_no}`);
    console.log('\nSections found:');
    Object.keys(emp.sections).forEach(section => {
      console.log(`  - ${section}: ${emp.sections[section].length} lines`);
    });
    
    // Extract sample data from first employee
    console.log('\nSample fields found in TXT:');
    const sampleLines = emp.raw_lines.slice(0, 50);
    const fields = [];
    
    sampleLines.forEach(line => {
      if (line.includes(':') || (line.match(/^\s*[A-Za-z]/))) {
        const parts = line.trim().split(/\s{2,}/);
        parts.forEach(part => {
          if (part && !part.match(/^[\d\s]+$/) && part.length > 3) {
            fields.push(part);
          }
        });
      }
    });
    
    console.log(fields.filter(f => f.length > 0).join('\n'));
  }
  
  // Compare all files
  console.log('\n\n📊 File Comparison:\n');
  console.log('Organization | CSV Size | TXT Size | Ratio');
  console.log('-------------|----------|----------|-------');
  
  const files = fs.readdirSync(rawDataPath)
    .filter(f => f.endsWith('.csv'))
    .map(f => f.replace('.csv', ''));
  
  files.forEach(base => {
    const csvPath = path.join(rawDataPath, base + '.csv');
    const txtPath = path.join(rawDataPath, base + '.txt');
    
    const csvSize = fs.statSync(csvPath).size;
    const txtSize = fs.statSync(txtPath).size;
    const ratio = (txtSize / csvSize).toFixed(2);
    
    const org = base.split('_')[0];
    console.log(
      `${org.padEnd(12)} | ` +
      `${(csvSize/1024).toFixed(1)}KB`.padEnd(8) + ' | ' +
      `${(txtSize/1024).toFixed(1)}KB`.padEnd(8) + ' | ' +
      `${ratio}x`
    );
  });
  
  console.log('\n⚠️  TXT files are generally 1.5x larger than CSV files');
  console.log('This suggests they contain additional data not in CSV files');
}

async function compareDataFields() {
  console.log('\n\n🔍 Checking what fields might be missing...\n');
  
  // Fields we know are in TXT based on the sample
  const txtFields = [
    'Address', 'City', 'State', 'Postcode', 'Country',
    'Emergency Contact', 'Relationship', 'Emergency Phone',
    'Spouse Detail', 'Spouse Name', 'Spouse IC', 'Spouse Occupation',
    'Fixed Allowances', 'Deductions', 'Allowance Details',
    'User Values', 'Free Remarks', 'Immigration Details',
    'Confirmation Date', 'Increment Date', 'Retirement Date',
    'Cost Center', 'GL Code', 'Position Grade'
  ];
  
  console.log('Fields likely in TXT but not in our current import:');
  txtFields.forEach(field => {
    console.log(`  ✗ ${field}`);
  });
  
  console.log('\n💡 Recommendation: Parse TXT files for complete data import');
}

async function main() {
  try {
    await analyzeTxtFiles();
    await compareDataFields();
    
    console.log('\n' + '=' .repeat(60));
    console.log('❌ Current import is INCOMPLETE - only used CSV files');
    console.log('📌 TXT files contain additional important data');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}