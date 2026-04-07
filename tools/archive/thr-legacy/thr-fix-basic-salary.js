#!/usr/bin/env node

/**
 * Fix basic_salary in master_hr2000 table
 * Extracts Current Basic salary from raw data
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse salary from format: "RM100,000.00" or "RM 100,000.00"
function parseSalary(salaryStr) {
  if (!salaryStr || salaryStr.trim() === '') {
    return null;
  }
  
  // Remove RM prefix and clean up
  let cleaned = salaryStr.replace(/RM\s*/i, '').trim();
  
  // Remove commas and convert to number
  cleaned = cleaned.replace(/,/g, '');
  
  const amount = parseFloat(cleaned);
  
  // Return null for 0 or invalid amounts
  if (isNaN(amount) || amount === 0) {
    return null;
  }
  
  return amount;
}

// Extract salary from CSV
function extractSalaryFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Current Basic')) {
      const parts = line.split(',');
      // Salary value is typically at index 4 (5th column) in format "100,000.00"
      if (parts[4] && parts[4].trim()) {
        return parseSalary(parts[4].trim());
      }
    }
  }
  return null;
}

// Extract salary from TXT
function extractSalaryFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Current Basic')) {
      // Extract amount after "Current Basic"
      const match = line.match(/Current Basic\s+RM([\d,]+\.?\d*)/);
      if (match) {
        return parseSalary('RM' + match[1]);
      }
    }
  }
  return null;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const salaryMap = new Map();
  
  // Process CSV files first
  console.log('📊 Processing CSV files for salary data...\n');
  
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  for (const file of csvFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let currentEmployee = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('Employee No.')) {
        const parts = line.split(',');
        if (parts[3]) {
          currentEmployee = parts[3].trim();
        }
      }
      
      if (currentEmployee && line.includes('Current Basic')) {
        const salary = extractSalaryFromCSV(lines, i);
        if (salary) {
          salaryMap.set(currentEmployee, salary);
          console.log(`  ✓ ${currentEmployee}: RM ${salary.toLocaleString()}`);
        }
      }
    }
  }
  
  // Process TXT files for any missing salaries
  console.log('\n📊 Processing TXT files for additional salary data...\n');
  
  const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
  for (const file of txtFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('Employee No.')) {
        // Handle different formats
        let employeeNo = null;
        const directMatch = line.match(/Employee No\.\s+([A-Z]+\d+)/);
        
        if (directMatch) {
          employeeNo = directMatch[1];
        } else if (line.includes('Employee No.')) {
          // Look for employee number in next lines
          for (let k = i + 1; k < Math.min(i + 5, lines.length); k++) {
            const nextLine = lines[k].trim();
            if (nextLine && nextLine.match(/^[A-Z]+\d+$/)) {
              employeeNo = nextLine;
              break;
            }
          }
        }
        
        if (employeeNo && !salaryMap.has(employeeNo)) {
          const salary = extractSalaryFromTXT(lines, i);
          if (salary) {
            salaryMap.set(employeeNo, salary);
            console.log(`  ✓ ${employeeNo}: RM ${salary.toLocaleString()} (from TXT)`);
          }
        }
      }
    }
  }
  
  return salaryMap;
}

// Update database
async function updateDatabase(salaryMap) {
  console.log(`\n💾 Updating basic salaries for ${salaryMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(salaryMap.entries()).map(([employee_no, basic_salary]) => ({
    employee_no,
    basic_salary
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ basic_salary: update.basic_salary })
        .eq('employee_no', update.employee_no);
      
      if (!error) {
        updated++;
        if (updated % 50 === 0) {
          console.log(`  ✓ Updated ${updated} records...`);
        }
      } else {
        errors++;
        console.error(`  ❌ Error updating ${update.employee_no}: ${error.message}`);
      }
    }
  }
  
  console.log(`\n✅ Successfully updated: ${updated} records`);
  if (errors > 0) {
    console.log(`❌ Errors: ${errors} records`);
  }
  
  return updated;
}

// Verify update
async function verifyUpdate() {
  console.log('\n🔍 Verifying salary data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withSalary } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('basic_salary', 'is', null);
  
  // Get salary distribution
  const { data: salaryData } = await supabase
    .from('master_hr2000')
    .select('basic_salary')
    .not('basic_salary', 'is', null);
  
  if (salaryData) {
    const salaryRanges = {
      'Below RM2,000': 0,
      'RM2,000 - RM5,000': 0,
      'RM5,001 - RM10,000': 0,
      'RM10,001 - RM20,000': 0,
      'Above RM20,000': 0
    };
    
    salaryData.forEach(row => {
      const salary = row.basic_salary;
      if (salary < 2000) salaryRanges['Below RM2,000']++;
      else if (salary <= 5000) salaryRanges['RM2,000 - RM5,000']++;
      else if (salary <= 10000) salaryRanges['RM5,001 - RM10,000']++;
      else if (salary <= 20000) salaryRanges['RM10,001 - RM20,000']++;
      else salaryRanges['Above RM20,000']++;
    });
    
    console.log(`📊 Statistics:`);
    console.log(`  Total employees: ${totalCount}`);
    console.log(`  With salary data: ${withSalary} (${((withSalary/totalCount)*100).toFixed(1)}%)`);
    
    console.log('\n📋 Salary Distribution:');
    Object.entries(salaryRanges).forEach(([range, count]) => {
      if (count > 0) {
        const percentage = ((count/withSalary)*100).toFixed(1);
        console.log(`  ${range}: ${count} employees (${percentage}%)`);
      }
    });
    
    // Calculate average and median
    const salaries = salaryData.map(r => r.basic_salary).sort((a, b) => a - b);
    const average = salaries.reduce((sum, s) => sum + s, 0) / salaries.length;
    const median = salaries[Math.floor(salaries.length / 2)];
    
    console.log(`\n  Average salary: RM ${average.toFixed(2)}`);
    console.log(`  Median salary: RM ${median.toFixed(2)}`);
  }
  
  // Show samples with highest and lowest salaries
  const { data: highestPaid } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, designation, basic_salary')
    .not('basic_salary', 'is', null)
    .order('basic_salary', { ascending: false })
    .limit(5);
  
  if (highestPaid && highestPaid.length > 0) {
    console.log('\n📋 Highest paid employees:');
    highestPaid.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'} (${emp.designation || 'N/A'})`);
      console.log(`    RM ${emp.basic_salary.toLocaleString()}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Basic Salary Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const salaryMap = await processFiles();
  
  if (salaryMap.size === 0) {
    console.log('\n⚠️  No salary data found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found salary data for ${salaryMap.size} employees`);
  
  // Update database
  await updateDatabase(salaryMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}