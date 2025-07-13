#!/usr/bin/env node

/**
 * Fix active status in master_hr2000 table
 * Sets active_status to false for employees with resign dates
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse date string
function parseDate(dateStr) {
  if (!dateStr || dateStr === '/ /' || dateStr === '/' || dateStr.trim() === '') {
    return null;
  }
  
  const cleaned = dateStr.replace(/['"]/g, '').trim();
  const parts = cleaned.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    if (day && month && year && year.length === 4) {
      const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }
  
  return null;
}

// Extract resign date from CSV
function extractResignDateFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Resign Date')) {
      const parts = line.split(',');
      // Resign Date is typically at index 11 or 12
      for (let j = 10; j < Math.min(parts.length, 14); j++) {
        const value = parts[j].trim();
        if (value && value !== '/ /' && value.match(/\d{2}\/\d{2}\/\d{4}/)) {
          return parseDate(value);
        }
      }
    }
  }
  
  return null;
}

// Extract resign date from TXT
function extractResignDateFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Resign Date')) {
      // Extract date after "Resign Date"
      const match = line.match(/Resign Date\s+(\d{2}\/\d{2}\/\d{4})/);
      if (match) {
        return parseDate(match[1]);
      }
      
      // Alternative: check if line contains a date
      const dateMatch = line.match(/\d{2}\/\d{2}\/\d{4}/);
      if (dateMatch && !line.includes('HireDate')) {
        return parseDate(dateMatch[0]);
      }
    }
  }
  
  return null;
}

// Process all files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const resignedEmployees = [];
  const activeEmployees = [];
  
  // Process CSV files
  console.log('📊 Processing CSV files for resign dates...\n');
  
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  for (const file of csvFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let currentEmployee = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for Employee No. row
      if (line.startsWith('Employee No.')) {
        const parts = line.split(',');
        if (parts[3]) {
          currentEmployee = parts[3].trim();
        }
      }
      
      // Extract resign date
      if (currentEmployee && line.includes('Resign Date')) {
        const resignDate = extractResignDateFromCSV(lines, i);
        if (resignDate) {
          resignedEmployees.push({
            employee_no: currentEmployee,
            resign_date: resignDate,
            source: 'CSV'
          });
        } else {
          activeEmployees.push(currentEmployee);
        }
      }
    }
  }
  
  // Process TXT files to verify or add more resign dates
  console.log('📊 Processing TXT files for resign dates...\n');
  
  const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
  for (const file of txtFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('Employee No.')) {
        const match = line.match(/Employee No\.\s+([A-Z]+\d+)/);
        if (match) {
          const employeeNo = match[1];
          const resignDate = extractResignDateFromTXT(lines, i);
          
          // Check if we already have this employee
          const existing = resignedEmployees.find(e => e.employee_no === employeeNo);
          
          if (resignDate && !existing) {
            resignedEmployees.push({
              employee_no: employeeNo,
              resign_date: resignDate,
              source: 'TXT'
            });
          } else if (!resignDate && !existing) {
            if (!activeEmployees.includes(employeeNo)) {
              activeEmployees.push(employeeNo);
            }
          }
        }
      }
    }
  }
  
  return { resigned: resignedEmployees, active: activeEmployees };
}

// Update database
async function updateDatabase(resignedEmployees) {
  console.log(`\n💾 Updating active status for ${resignedEmployees.length} resigned employees...\n`);
  
  let updated = 0;
  for (const emp of resignedEmployees) {
    const { error } = await supabase
      .from('master_hr2000')
      .update({ 
        active_status: false
      })
      .eq('employee_no', emp.employee_no);
    
    if (!error) {
      updated++;
      console.log(`  ✓ ${emp.employee_no} - Resigned: ${emp.resign_date}`);
    } else {
      console.error(`  ❌ Error updating ${emp.employee_no}: ${error.message}`);
    }
  }
  
  return updated;
}

// Main
async function main() {
  console.log('🔧 THR Active Status Fix Tool\n');
  console.log('=' .repeat(60));
  
  // First, check current status
  console.log('\n📊 Current status in database:');
  
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: activeCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .eq('active_status', true);
  
  const { count: inactiveCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .eq('active_status', false);
  
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  Active: ${activeCount}`);
  console.log(`  Inactive: ${inactiveCount}`);
  
  // Process files
  const { resigned, active } = await processFiles();
  
  console.log(`\n📋 Found in raw data:`);
  console.log(`  Resigned employees: ${resigned.length}`);
  console.log(`  Active employees: ${active.length}`);
  
  // Show some examples
  if (resigned.length > 0) {
    console.log(`\n📅 Sample resigned employees:`);
    resigned.slice(0, 5).forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.resign_date} (from ${emp.source})`);
    });
  }
  
  // Update database
  if (resigned.length > 0) {
    const updated = await updateDatabase(resigned);
    
    // Verify final status
    console.log('\n🔍 Verifying update...');
    
    const { count: newInactiveCount } = await supabase
      .from('master_hr2000')
      .select('*', { count: 'exact', head: true })
      .eq('active_status', false);
    
    const { data: samples } = await supabase
      .from('master_hr2000')
      .select('employee_no, employee_name, active_status')
      .eq('active_status', false)
      .limit(5);
    
    console.log(`\n✅ Complete!`);
    console.log(`  Total inactive employees: ${newInactiveCount}`);
    console.log(`  Updated: ${updated} records`);
    
    if (samples && samples.length > 0) {
      console.log(`\n📋 Sample inactive employees:`);
      samples.forEach(emp => {
        console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      });
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}