#!/usr/bin/env node

/**
 * Populate resign_date column in master_hr2000 table
 * Extracts resign dates from raw data and updates the table
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

// Extract resign dates from files (reusing logic from previous script)
async function extractResignDates() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  const resignDates = new Map();
  
  // Process CSV files
  console.log('📊 Extracting resign dates from CSV files...\n');
  
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
      
      if (currentEmployee && line.includes('Resign Date')) {
        const parts = line.split(',');
        for (let j = 10; j < Math.min(parts.length, 14); j++) {
          const value = parts[j].trim();
          if (value && value !== '/ /' && value.match(/\d{2}\/\d{2}\/\d{4}/)) {
            const resignDate = parseDate(value);
            if (resignDate) {
              resignDates.set(currentEmployee, resignDate);
              console.log(`  ✓ ${currentEmployee}: ${resignDate}`);
            }
            break;
          }
        }
      }
    }
  }
  
  return resignDates;
}

// Update database with resign dates
async function updateResignDates(resignDates) {
  console.log(`\n💾 Updating ${resignDates.size} resign dates in database...\n`);
  
  let updated = 0;
  let errors = 0;
  
  for (const [employeeNo, resignDate] of resignDates) {
    const { error } = await supabase
      .from('master_hr2000')
      .update({ 
        resign_date: resignDate,
        active_status: false  // Also update active status
      })
      .eq('employee_no', employeeNo);
    
    if (!error) {
      updated++;
    } else {
      errors++;
      console.error(`  ❌ Error updating ${employeeNo}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Successfully updated: ${updated} records`);
  if (errors > 0) {
    console.log(`❌ Errors: ${errors} records`);
  }
  
  return updated;
}

// Verify the update
async function verifyUpdate() {
  console.log('\n🔍 Verifying resign_date data...\n');
  
  // Check if column exists first
  const { data: testData, error: testError } = await supabase
    .from('master_hr2000')
    .select('resign_date')
    .limit(1);
  
  if (testError && testError.message.includes('column')) {
    console.log('❌ ERROR: resign_date column does not exist!');
    console.log('\nPlease add the column first using this SQL command in Supabase:');
    console.log('\nALTER TABLE master_hr2000 ADD COLUMN resign_date DATE;');
    return false;
  }
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withResignDate } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('resign_date', 'is', null);
  
  const { count: activeCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .eq('active_status', true);
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With resign dates: ${withResignDate} (${((withResignDate/totalCount)*100).toFixed(1)}%)`);
  console.log(`  Active employees: ${activeCount} (${((activeCount/totalCount)*100).toFixed(1)}%)`);
  console.log(`  Resigned employees: ${totalCount - activeCount} (${(((totalCount - activeCount)/totalCount)*100).toFixed(1)}%)`);
  
  // Show samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, employment_date, confirmation_date, resign_date, active_status')
    .not('resign_date', 'is', null)
    .order('resign_date', { ascending: false })
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Recent resignations:');
    samples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    Started: ${emp.employment_date || 'N/A'} | Confirmed: ${emp.confirmation_date || 'N/A'} | Resigned: ${emp.resign_date}`);
    });
  }
  
  return true;
}

// Main
async function main() {
  console.log('🔧 THR Resign Date Population Tool\n');
  console.log('=' .repeat(60));
  
  // First verify if column exists
  const columnExists = await verifyUpdate();
  if (!columnExists) {
    console.log('\n⚠️  Please add the resign_date column first, then run this script again.');
    return;
  }
  
  // Extract resign dates
  const resignDates = await extractResignDates();
  
  if (resignDates.size === 0) {
    console.log('\n⚠️  No resign dates found in raw data.');
    return;
  }
  
  // Update database
  await updateResignDates(resignDates);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}