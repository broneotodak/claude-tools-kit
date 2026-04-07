#!/usr/bin/env node

/**
 * THR TXT Parser - Fixed Width Format
 * Handles the specific column positions in HR2000 TXT files
 */

const fs = require('fs');
const path = require('path');

// Parse a single employee from TXT format with fixed column positions
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
    emails: [], 
    address: [],
    
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
    
    // Metadata
    raw_lines: []
  };
  
  // Helper to extract value based on fixed position
  const extractValue = (line, startPos, endPos) => {
    if (line.length < startPos) return null;
    const value = line.substring(startPos, endPos || line.length).trim();
    return value === '' || value === '/' || value === '/ /' ? null : value;
  };
  
  // Process lines
  for (let i = startIdx; i < Math.min(startIdx + 150, lines.length); i++) {
    const line = lines[i];
    employee.raw_lines.push(line);
    
    // Employee number - appears after "Employee No."
    if (line.includes('Employee No.') && !employee.employee_no) {
      employee.employee_no = extractValue(line, 17);
    }
    
    // Name - appears after "Name" label with varying spacing
    else if (line.includes('Name ') && !line.includes('Spouse') && !employee.name) {
      const nameMatch = line.match(/Name\s+(.+?)$/);
      if (nameMatch) {
        employee.name = nameMatch[1].trim();
      }
    }
    
    // IC New and Nationality - same line
    else if (line.includes('I/C No. (New)')) {
      const icMatch = line.match(/I\/C No\. \(New\)\s+(\S+)/);
      if (icMatch) employee.ic_new = icMatch[1];
      const natMatch = line.match(/Nationality\s+(.+?)$/);
      if (natMatch) employee.nationality = natMatch[1].trim();
    }
    
    // IC Old and Race - same line
    else if (line.includes('I/C No. (OLD)')) {
      const icMatch = line.match(/I\/C No\. \(OLD\)\s+(\S+)/);
      if (icMatch) employee.ic_old = icMatch[1];
      const raceMatch = line.match(/Race\s+(.+?)$/);
      if (raceMatch) employee.race = raceMatch[1].trim();
    }
    
    // Passport and Religion - same line
    else if (line.includes('Passport No.')) {
      const passMatch = line.match(/Passport No\.\s+(\S+)/);
      if (passMatch) employee.passport_no = passMatch[1];
      const relMatch = line.match(/Religion\s+(.+?)$/);
      if (relMatch) employee.religion = relMatch[1].trim();
    }
    
    // Immigration and Sex - same line
    else if (line.includes('Immigration No.')) {
      const immMatch = line.match(/Immigration No\.\s+(\S+)/);
      if (immMatch) employee.immigration_no = immMatch[1];
      const sexMatch = line.match(/Sex\s+(.+?)$/);
      if (sexMatch) employee.gender = sexMatch[1].trim();
    }
    
    // Birth Date and Children - same line
    else if (line.includes('Birth Date')) {
      const birthMatch = line.match(/Birth Date\s+(\d{2}\/\d{2}\/\d{4})/);
      if (birthMatch) employee.birth_date = birthMatch[1];
      const childMatch = line.match(/No\. of Children\s+(\d+)/);
      if (childMatch) employee.children_count = childMatch[1];
    }
    
    // Marital Status
    else if (line.includes('Marital Status')) {
      const maritalMatch = line.match(/Marital Status\s+(.+?)$/);
      if (maritalMatch) employee.marital_status = maritalMatch[1].trim();
    }
    
    // Region
    else if (line.includes('Region')) {
      const regionMatch = line.match(/Region\s+(.+?)$/);
      if (regionMatch) employee.region = regionMatch[1].trim();
    }
    
    // Current Basic and Hire Date - same line
    else if (line.includes('Current Basic')) {
      const basicMatch = line.match(/Current Basic\s+RM([\d,]+\.?\d*)/);
      if (basicMatch) employee.current_basic = basicMatch[1].replace(/,/g, '');
      const hireMatch = line.match(/HireDate\s+(\d{2}\/\d{2}\/\d{4})/);
      if (hireMatch) employee.hire_date = hireMatch[1];
    }
    
    // Resign Date
    else if (line.includes('Resign Date')) {
      const resignMatch = line.match(/Resign Date\s+(\d{2}\/\d{2}\/\d{4})/);
      if (resignMatch && resignMatch[1] !== '31/12/2024') { // Default value
        employee.resign_date = resignMatch[1];
      }
    }
    
    // Payment Type
    else if (line.includes('Payment Type')) {
      const typeMatch = line.match(/Payment Type\s+(.+?)(?:\s{2,}|$)/);
      if (typeMatch) employee.payment_type = typeMatch[1].trim();
    }
    
    // Payment Frequency
    else if (line.includes('Payment Frequency')) {
      const freqMatch = line.match(/Payment Frequency\s+(.+?)(?:\s{2,}|$)/);
      if (freqMatch) employee.payment_frequency = freqMatch[1].trim();
    }
    
    // Payment Via and Cost Center
    else if (line.includes('Payment Via')) {
      const payMatch = line.match(/Payment Via\s+([^\s]+)/);
      if (payMatch) employee.payment_via = payMatch[1];
      const costMatch = line.match(/Cost Center\s+(.+?)$/);
      if (costMatch) employee.cost_center = costMatch[1].trim();
    }
    
    // Bank details and Department
    else if (line.includes('Bank Code/ Branch')) {
      const bankMatch = line.match(/Bank Code\/ Branch\s+([^\s]+)/);
      if (bankMatch) {
        const parts = bankMatch[1].split('/');
        employee.bank_code = parts[0];
        employee.bank_branch = parts[1] || null;
      }
      const deptMatch = line.match(/Department\s+(.+?)$/);
      if (deptMatch) employee.department = deptMatch[1].trim();
    }
    
    // Bank Account and Section
    else if (line.includes('Bank Account No')) {
      const acctMatch = line.match(/Bank Account No\s+(\d+)/);
      if (acctMatch) employee.bank_account = acctMatch[1];
      const sectMatch = line.match(/Section\s+(.+?)$/);
      if (sectMatch) employee.section = sectMatch[1].trim();
    }
    
    // Category
    else if (line.includes('Category') && !line.includes('SOCSO')) {
      employee.category = extractValue(line, 50);
    }
    
    // Occupation
    else if (line.includes('Country') && !line.includes('Postcode')) {
      employee.occupation = extractValue(line, 50);
    }
    
    // EPF Number
    else if (line.includes('Epf No')) {
      const epfMatch = line.match(/Epf No\s+(\d+)/);
      if (epfMatch) employee.epf_no = epfMatch[1];
    }
    
    // SOCSO Number
    else if (line.includes('SOCSO / KSPA No')) {
      const socsoMatch = line.match(/SOCSO \/ KSPA No\s+(\S+)/);
      if (socsoMatch) employee.socso_no = socsoMatch[1];
    }
    
    // Income Tax
    else if (line.includes('Income Tax No') && !line.includes('Spouse')) {
      const taxMatch = line.match(/Income Tax No\s+(\S+)/);
      if (taxMatch) employee.income_tax_no = taxMatch[1];
    }
    
    // Email
    else if (line.includes('E-Mail')) {
      const emailData = extractValue(line, 17);
      if (emailData) {
        // Split by | and clean up
        const emails = emailData.split('|')
          .map(e => e.trim())
          .filter(e => e && e.includes('@'));
        employee.emails = emails;
      }
    }
    
    // Mobile and Home Telephone
    else if (line.includes('Home Telephone')) {
      const homeMatch = line.match(/Home Telephone\s+(\S+)/);
      if (homeMatch && homeMatch[1] !== '/') employee.home_phone = homeMatch[1];
      const mobileMatch = line.match(/Mobile\s+(\S+)/);
      if (mobileMatch && mobileMatch[1] !== '/') employee.mobile.push(mobileMatch[1]);
    }
    
    // Home Address (may span multiple lines)
    else if (line.includes('Home Address')) {
      const addr = extractValue(line, 17);
      if (addr) {
        employee.address.push(addr);
      }
      // Check next lines for address continuation
      for (let j = i + 1; j < i + 3 && j < lines.length; j++) {
        const nextLine = lines[j];
        if (!nextLine.includes(':') && nextLine.trim() && !nextLine.includes('Postal')) {
          const addrLine = nextLine.trim();
          if (addrLine) employee.address.push(addrLine);
        }
      }
    }
  }
  
  // Clean up arrays
  employee.mobile = employee.mobile.filter(m => m);
  employee.emails = [...new Set(employee.emails)];
  
  return employee;
}

// Test parser on a sample file
async function testParser() {
  const testFile = '/Users/broneotodak/Projects/THR/raw_data/TCSB_Employee Master.txt';
  console.log('🧪 Testing fixed-width parser...\n');
  
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
    console.log(`Religion: ${emp.religion}`);
    console.log(`Birth Date: ${emp.birth_date}`);
    console.log(`Gender: ${emp.gender}`);
    console.log(`Marital Status: ${emp.marital_status}`);
    console.log(`Children: ${emp.children_count}`);
    console.log(`Emails: ${emp.emails.join(', ')}`);
    console.log(`Mobile: ${emp.mobile.join(', ')}`);
    console.log(`Address: ${emp.address.join(' ')}`);
    console.log(`Department: ${emp.department}`);
    console.log(`Hire Date: ${emp.hire_date}`);
    console.log(`Current Basic: RM ${emp.current_basic}`);
    console.log(`Bank Code: ${emp.bank_code}`);
    console.log(`Bank Account: ${emp.bank_account}`);
    console.log(`EPF No: ${emp.epf_no}`);
    console.log(`SOCSO No: ${emp.socso_no}`);
    console.log(`Income Tax: ${emp.income_tax_no}`);
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
    ['Bank Account', emp => emp.bank_account],
    ['EPF No', emp => emp.epf_no],
    ['Current Basic', emp => emp.current_basic]
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