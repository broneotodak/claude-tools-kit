#!/usr/bin/env node

/**
 * Fix employment_date in master_hr2000 table
 * Extracts HireDate from raw data
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse date from format: "01/11/2024(00 yr 06 Mth)" or "01/11/2024"
function parseEmploymentDate(dateStr) {
  if (!dateStr || dateStr.trim() === '' || dateStr.includes('/ /')) {
    return null;
  }
  
  // Extract just the date part before parentheses
  const datePart = dateStr.split('(')[0].trim();
  
  // Parse DD/MM/YYYY format
  const parts = datePart.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // JS months are 0-based
    const year = parseInt(parts[2]);
    
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      const date = new Date(year, month, day);
      return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    }
  }
  
  return null;
}

// Extract hire date from CSV
function extractHireDateFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('HireDate')) {
      const parts = line.split(',');
      // HireDate value is typically at index 12 (13th column)
      if (parts[12] && parts[12].trim() && !parts[12].includes('/ /')) {
        return parseEmploymentDate(parts[12].trim());
      }
    }
  }
  return null;
}

// Extract hire date from TXT
function extractHireDateFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('HireDate')) {
      // Extract date after "HireDate"
      const match = line.match(/HireDate\s+(\d{2}\/\d{2}\/\d{4}[^,\s]*)/);
      if (match) {
        return parseEmploymentDate(match[1]);
      }
    }
  }
  return null;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const employmentDateMap = new Map();
  
  // Process CSV files first
  console.log('📊 Processing CSV files for employment dates...\n');
  
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
      
      if (currentEmployee && line.includes('HireDate')) {
        const hireDate = extractHireDateFromCSV(lines, i);
        if (hireDate) {
          employmentDateMap.set(currentEmployee, hireDate);
          console.log(`  ✓ ${currentEmployee}: ${hireDate}`);
        }
      }
    }
  }
  
  // Process TXT files for any missing dates
  console.log('\n📊 Processing TXT files for additional employment dates...\n');
  
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
        
        if (employeeNo && !employmentDateMap.has(employeeNo)) {
          const hireDate = extractHireDateFromTXT(lines, i);
          if (hireDate) {
            employmentDateMap.set(employeeNo, hireDate);
            console.log(`  ✓ ${employeeNo}: ${hireDate} (from TXT)`);
          }
        }
      }
    }
  }
  
  return employmentDateMap;
}

// Update database
async function updateDatabase(employmentDateMap) {
  console.log(`\n💾 Updating employment dates for ${employmentDateMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(employmentDateMap.entries()).map(([employee_no, employment_date]) => ({
    employee_no,
    employment_date
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ employment_date: update.employment_date })
        .eq('employee_no', update.employee_no);
      
      if (!error) {
        updated++;
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
  console.log('\n🔍 Verifying employment date data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withEmploymentDate } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('employment_date', 'is', null);
  
  // Get date distribution by year
  const { data: dateData } = await supabase
    .from('master_hr2000')
    .select('employment_date')
    .not('employment_date', 'is', null);
  
  const yearCount = {};
  dateData.forEach(row => {
    const year = new Date(row.employment_date).getFullYear();
    yearCount[year] = (yearCount[year] || 0) + 1;
  });
  
  console.log(`📊 Statistics:`)
  console.log(`  Total employees: ${totalCount}`)
  console.log(`  With employment date: ${withEmploymentDate} (${((withEmploymentDate/totalCount)*100).toFixed(1)}%)`);
  
  console.log('\n📋 Employment by Year:');
  Object.entries(yearCount)
    .sort((a, b) => b[0] - a[0])
    .forEach(([year, count]) => {
      console.log(`  ${year}: ${count} employees`);
    });
  
  // Show samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, employment_date, active_status')
    .not('employment_date', 'is', null)
    .order('employment_date', { ascending: false })
    .limit(10);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Recent hires:');
    samples.forEach(emp => {
      const date = new Date(emp.employment_date);
      const formattedDate = date.toLocaleDateString('en-GB');
      const status = emp.active_status ? 'Active' : 'Resigned';
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'} - ${formattedDate} (${status})`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Employment Date Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const employmentDateMap = await processFiles();
  
  if (employmentDateMap.size === 0) {
    console.log('\n⚠️  No employment dates found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found employment dates for ${employmentDateMap.size} employees`);
  
  // Update database
  await updateDatabase(employmentDateMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}