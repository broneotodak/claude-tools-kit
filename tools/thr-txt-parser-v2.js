#!/usr/bin/env node

/**
 * THR TXT Parser V2 - Improved parser for HR2000 TXT format
 * Handles complex spacing and multi-value fields
 */

const fs = require('fs');
const path = require('path');

// Parse a single employee from TXT format
function parseEmployeeFromTxt(lines, startIdx) {
  const employee = {
    // Core identification
    employee_no: null,
    
    // Personal details
    name: null,
    ic_new: null,
    ic_old: null,
    passport_no: null,
    nationality: null,
    race: null,
    religion: null,
    gender: null,
    marital_status: null,
    birth_date: null,
    birth_place: null,
    children_count: null,
    region: null,
    
    // Contact details
    mobile: [],
    home_phone: null,
    emails: [], // Can have multiple
    address: [],
    city: null,
    state: null,
    postcode: null,
    country: null,
    
    // Employment details
    hire_date: null,
    resign_date: null,
    confirm_date: null,
    increment_date: null,
    retire_date: null,
    department: null,
    section: null,
    designation: null,
    category: null,
    occupation: null,
    cost_center: null,
    reporting_to: null,
    grade: null,
    
    // Payment details
    current_basic: null,
    mid_basic: null,
    previous_basic: null,
    payment_type: null,
    payment_frequency: null,
    payment_via: null,
    bank_code: null,
    bank_branch: null,
    bank_account: null,
    
    // Statutory
    epf_no: null,
    socso_no: null,
    income_tax_no: null,
    income_tax_branch: null,
    eis: null,
    pcb: null,
    ea_form: null,
    
    // Spouse details
    spouse: {
      name: null,
      ic: null,
      occupation: null,
      employer: null,
      income_tax_no: null,
      income_tax_branch: null
    },
    
    // Arrays for multiple values
    allowances: [],
    deductions: [],
    
    // Metadata
    raw_lines: []
  };
  
  // Helper to extract value from a line with label
  const extractAfterLabel = (line, label) => {
    const idx = line.indexOf(label);
    if (idx === -1) return null;
    
    // Get everything after the label
    let value = line.substring(idx + label.length).trim();
    
    // If there's another field on same line (common pattern), split it
    // Look for pattern like "Field1 value1    Field2 value2"
    const nextFieldMatch = value.match(/^([^A-Z]+?)(?:\s{2,}[A-Z]|$)/);
    if (nextFieldMatch) {
      value = nextFieldMatch[1].trim();
    }
    
    // Clean up common patterns
    value = value.replace(/\s+$/, ''); // trailing spaces
    value = value.replace(/^:\s*/, ''); // leading colons
    value = value.replace(/\|$/, '').trim(); // trailing pipes
    
    return value === '' || value === '/' || value === '/ /' ? null : value;
  };
  
  // Helper to extract two fields from same line
  const extractTwoFields = (line, label1, label2) => {
    const field1 = extractAfterLabel(line, label1);
    
    // Find where label2 starts
    const idx2 = line.indexOf(label2);
    if (idx2 > -1) {
      const field2 = extractAfterLabel(line.substring(idx2), label2);
      return [field1, field2];
    }
    
    return [field1, null];
  };
  
  // Process lines
  let inSpouseSection = false;
  let inAllowanceSection = false;
  
  for (let i = startIdx; i < Math.min(startIdx + 150, lines.length); i++) {
    const line = lines[i];
    employee.raw_lines.push(line);
    
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Detect sections
    if (line.includes('SPOUSE DETAIL')) {
      inSpouseSection = true;
      continue;
    }
    if (line.includes('Fixed Allowance') || line.includes('FIXED ALLOWANCE')) {
      inAllowanceSection = true;
      continue;
    }
    
    // Employee number (appears once at start)
    if (line.includes('Employee No.') && !employee.employee_no) {
      employee.employee_no = extractAfterLabel(line, 'Employee No.');
    }
    
    // Personal section
    else if (line.includes('Name') && !line.includes('Spouse') && !inSpouseSection) {
      employee.name = extractAfterLabel(line, 'Name');
    }
    else if (line.includes('I/C No. (New)')) {
      const [ic, nat] = extractTwoFields(line, 'I/C No. (New)', 'Nationality');
      employee.ic_new = ic;
      employee.nationality = nat;
    }
    else if (line.includes('I/C No. (OLD)')) {
      const [ic, race] = extractTwoFields(line, 'I/C No. (OLD)', 'Race');
      employee.ic_old = ic;
      employee.race = race;
    }
    else if (line.includes('Passport No.')) {
      const [passport, religion] = extractTwoFields(line, 'Passport No.', 'Religion');
      employee.passport_no = passport;
      employee.religion = religion;
    }
    else if (line.includes('Immigration No.')) {
      const [imm, sex] = extractTwoFields(line, 'Immigration No.', 'Sex');
      employee.gender = sex;
    }
    else if (line.includes('Birth Date')) {
      const [birth, children] = extractTwoFields(line, 'Birth Date', 'No. of Children');
      if (birth) {
        // Extract just the date part (before age in parentheses)
        const dateMatch = birth.match(/(\d{2}\/\d{2}\/\d{4})/);
        employee.birth_date = dateMatch ? dateMatch[1] : birth;
      }
      employee.children_count = children;
    }
    else if (line.includes('Marital Status')) {
      employee.marital_status = extractAfterLabel(line, 'Marital Status');
    }
    
    // Contact details
    else if (line.includes('Mobile') && !line.includes('Spouse')) {
      const mobile = extractAfterLabel(line, 'Mobile');
      if (mobile && mobile !== '|') {
        employee.mobile.push(mobile);
      }
    }
    else if (line.includes('H/Phone') || line.includes('Home Telephone')) {
      const [home, mobile] = extractTwoFields(line, line.includes('H/Phone') ? 'H/Phone' : 'Home Telephone', 'Mobile');
      employee.home_phone = home;
      if (mobile && mobile !== '|') {
        employee.mobile.push(mobile);
      }
    }
    else if (line.includes('E-Mail') || line.includes('Email')) {
      const email = extractAfterLabel(line, line.includes('E-Mail') ? 'E-Mail' : 'Email');
      if (email) {
        // Split multiple emails by | or ,
        const emails = email.split(/[|,]/).map(e => e.trim()).filter(e => e && e.includes('@'));
        employee.emails.push(...emails);
      }
    }
    else if (line.includes('Address') && !line.includes('Email')) {
      let addr = extractAfterLabel(line, 'Address');
      if (addr) {
        employee.address.push(addr);
        // Check next lines for continuation
        for (let j = i + 1; j < i + 3 && j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.includes(':') && !nextLine.match(/^[A-Z]/)) {
            employee.address.push(nextLine);
          }
        }
      }
    }
    else if (line.includes('Postcode')) {
      const [postcode, country] = extractTwoFields(line, 'Postcode', 'Country');
      employee.postcode = postcode;
      employee.country = country;
    }
    else if (line.includes('City')) {
      const [city, state] = extractTwoFields(line, 'City', 'State');
      employee.city = city;
      employee.state = state;
    }
    
    // Employment section
    else if (line.includes('HireDate') || line.includes('Employment Date')) {
      let hireDate = extractAfterLabel(line, line.includes('HireDate') ? 'HireDate' : 'Employment Date');
      if (hireDate) {
        const dateMatch = hireDate.match(/(\d{2}\/\d{2}\/\d{4})/);
        employee.hire_date = dateMatch ? dateMatch[1] : hireDate;
      }
    }
    else if (line.includes('Resign Date')) {
      let resignDate = extractAfterLabel(line, 'Resign Date');
      if (resignDate && resignDate !== '31/12/2024') { // This seems to be a default
        employee.resign_date = resignDate;
      }
    }
    else if (line.includes('Department')) {
      employee.department = extractAfterLabel(line, 'Department');
    }
    else if (line.includes('Designation')) {
      employee.designation = extractAfterLabel(line, 'Designation');
    }
    else if (line.includes('Cost Center')) {
      employee.cost_center = extractAfterLabel(line, 'Cost Center');
    }
    
    // Payment section
    else if (line.includes('Current Basic')) {
      // Next line usually has the amount
      if (i + 1 < lines.length) {
        const amountLine = lines[i + 1];
        const amountMatch = amountLine.match(/RM\s*([\d,]+\.?\d*)/);
        if (amountMatch) {
          employee.current_basic = amountMatch[1].replace(/,/g, '');
        }
      }
    }
    else if (line.includes('Bank Account No')) {
      employee.bank_account = extractAfterLabel(line, 'Bank Account No');
    }
    else if (line.includes('Bank Code')) {
      const bankInfo = extractAfterLabel(line, 'Bank Code/ Branch') || extractAfterLabel(line, 'Bank Code');
      if (bankInfo) {
        const parts = bankInfo.split('/');
        employee.bank_code = parts[0];
        employee.bank_branch = parts[1] || null;
      }
    }
    
    // Statutory
    else if (line.includes('Epf No') || line.includes('EPF No')) {
      employee.epf_no = extractAfterLabel(line, line.includes('Epf No') ? 'Epf No' : 'EPF No');
    }
    else if (line.includes('SOCSO') || line.includes('Socso No')) {
      employee.socso_no = extractAfterLabel(line, line.includes('SOCSO') ? 'SOCSO / KSPA No' : 'Socso No');
    }
    else if (line.includes('Income Tax No')) {
      const [tax, branch] = extractTwoFields(line, 'Income Tax No', 'Income Tax Branch');
      employee.income_tax_no = tax;
      employee.income_tax_branch = branch;
    }
    
    // Spouse section
    else if (inSpouseSection) {
      if (line.includes('Name') && !employee.spouse.name) {
        const [name, ic] = extractTwoFields(line, 'Name', 'I/C No');
        employee.spouse.name = name;
        employee.spouse.ic = ic;
      }
      else if (line.includes('Income Tax No')) {
        const [tax, branch] = extractTwoFields(line, 'Income Tax No', 'Income Tax Branch');
        employee.spouse.income_tax_no = tax;
        employee.spouse.income_tax_branch = branch;
      }
    }
    
    // Allowances section
    else if (inAllowanceSection) {
      // Look for pattern: number, description, amount
      const match = line.match(/^\s*(\d+)\s+(.+?)\s+([\d,]+\.?\d*)\s+/);
      if (match) {
        const desc = match[2].trim();
        const amount = match[3].replace(/,/g, '');
        if (desc && parseFloat(amount) > 0) {
          employee.allowances.push({
            description: desc,
            amount: parseFloat(amount)
          });
        }
      }
    }
  }
  
  // Clean up arrays
  employee.mobile = [...new Set(employee.mobile)]; // Remove duplicates
  employee.emails = [...new Set(employee.emails)];
  
  return employee;
}

// Test parser on a sample file
async function testParser() {
  const testFile = '/Users/broneotodak/Projects/THR/raw_data/TCSB_Employee Master.txt';
  console.log('🧪 Testing improved parser...\n');
  
  const content = fs.readFileSync(testFile, 'utf8');
  const lines = content.split('\n');
  
  // Find first few employees
  const employees = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Employee No.') && lines[i].match(/[A-Z]+\d+/)) {
      const emp = parseEmployeeFromTxt(lines, i);
      employees.push(emp);
      if (employees.length >= 3) break; // Just test first 3
    }
  }
  
  // Display results
  employees.forEach((emp, idx) => {
    console.log(`\nEmployee ${idx + 1}:`);
    console.log('=' .repeat(50));
    console.log(`Employee No: ${emp.employee_no}`);
    console.log(`Name: ${emp.name}`);
    console.log(`IC (New): ${emp.ic_new}`);
    console.log(`IC (Old): ${emp.ic_old}`);
    console.log(`Nationality: ${emp.nationality}`);
    console.log(`Race: ${emp.race}`);
    console.log(`Birth Date: ${emp.birth_date}`);
    console.log(`Gender: ${emp.gender}`);
    console.log(`Emails: ${emp.emails.join(', ')}`);
    console.log(`Mobile: ${emp.mobile.join(', ')}`);
    console.log(`Address: ${emp.address.join(' ')}`);
    console.log(`Department: ${emp.department}`);
    console.log(`Hire Date: ${emp.hire_date}`);
    console.log(`Bank Account: ${emp.bank_account}`);
    console.log(`Current Basic: ${emp.current_basic}`);
    console.log(`Spouse Name: ${emp.spouse.name}`);
    console.log(`Allowances: ${emp.allowances.length} items`);
    
    if (emp.allowances.length > 0) {
      emp.allowances.forEach(allow => {
        console.log(`  - ${allow.description}: RM ${allow.amount}`);
      });
    }
  });
  
  // Summary of data quality
  console.log('\n\n📊 Data Quality Check:');
  console.log('=' .repeat(50));
  
  const fields = [
    ['Name', emp => emp.name],
    ['IC Number', emp => emp.ic_new || emp.ic_old],
    ['Email', emp => emp.emails.length > 0],
    ['Mobile', emp => emp.mobile.length > 0],
    ['Department', emp => emp.department],
    ['Hire Date', emp => emp.hire_date],
    ['Bank Account', emp => emp.bank_account]
  ];
  
  fields.forEach(([field, getter]) => {
    const hasData = employees.filter(emp => getter(emp)).length;
    console.log(`${field}: ${hasData}/${employees.length}`);
  });
}

// Export for use in import tool
module.exports = {
  parseEmployeeFromTxt
};

// Run test if called directly
if (require.main === module) {
  testParser().catch(console.error);
}