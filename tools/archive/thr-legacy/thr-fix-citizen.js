#!/usr/bin/env node

/**
 * Fix citizen in master_hr2000 table
 * Extracts nationality and maps to citizen field
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Map nationality to citizen boolean (true = citizen, false = non-citizen)
function mapToCitizen(nationality) {
  if (!nationality) return null;
  
  // Clean and uppercase
  const cleaned = nationality.trim().toUpperCase();
  
  // Malaysian citizens = true
  const citizenValues = [
    'MALAYSIAN',
    'MALAYSIA', 
    'WARGANEGARA',
    'WARGANEGARA MALAYSIA'
  ];
  
  // Non-citizens = false
  const nonCitizenValues = [
    'BUKAN WARGANEGARA',
    'NON-CITIZEN',
    'FOREIGNER',
    'PERMANENT RESIDENT',
    'PR'
  ];
  
  if (citizenValues.includes(cleaned)) {
    return true;
  } else if (nonCitizenValues.includes(cleaned)) {
    return false;
  }
  
  // Default to null if uncertain
  return null;
}

// Extract nationality from CSV
function extractNationalityFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 10, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Nationality')) {
      const parts = line.split(',');
      // Nationality value is at index 8 (9th column)
      if (parts[8] && parts[8].trim() && parts[8].trim() !== '') {
        return mapToCitizen(parts[8].trim());
      }
    }
  }
  return null;
}

// Extract nationality from TXT
function extractNationalityFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Nationality') && line.includes('I/C No')) {
      // Extract text after "Nationality"
      const match = line.match(/Nationality\s+([A-Z\s]+?)(?:\s{2,}|$)/);
      if (match) {
        return mapToCitizen(match[1]);
      }
      
      // Alternative: split by "Nationality"
      const parts = line.split('Nationality');
      if (parts.length > 1) {
        const nationality = parts[1].trim().split(/\s{2,}/)[0];
        if (nationality && nationality.length > 0) {
          return mapToCitizen(nationality);
        }
      }
    }
  }
  return null;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const citizenData = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for citizenship data...\n');
  
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
      
      if (currentEmployee && line.includes('Nationality')) {
        const citizen = extractNationalityFromCSV(lines, i);
        if (citizen) {
          citizenData.set(currentEmployee, citizen);
          console.log(`  ✓ ${currentEmployee}: ${citizen}`);
        }
      }
    }
  }
  
  // Process TXT files to get more citizenship data
  console.log('\n📊 Processing TXT files for citizenship data...\n');
  
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
          const citizen = extractNationalityFromTXT(lines, i);
          
          if (citizen && !citizenData.has(employeeNo)) {
            citizenData.set(employeeNo, citizen);
            console.log(`  ✓ ${employeeNo}: ${citizen} (from TXT)`);
          }
        }
      }
    }
  }
  
  return citizenData;
}

// Update database
async function updateDatabase(citizenData) {
  console.log(`\n💾 Updating citizenship for ${citizenData.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(citizenData.entries()).map(([employee_no, citizen]) => ({
    employee_no,
    citizen
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ citizen: update.citizen })
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
  console.log('\n🔍 Verifying citizenship data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withCitizen } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('citizen', 'is', null);
  
  // Get citizen distribution
  const { data: distribution } = await supabase
    .from('master_hr2000')
    .select('citizen')
    .not('citizen', 'is', null);
  
  const citizenCount = {};
  distribution.forEach(row => {
    const citizen = row.citizen;
    citizenCount[citizen] = (citizenCount[citizen] || 0) + 1;
  });
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With citizenship data: ${withCitizen} (${((withCitizen/totalCount)*100).toFixed(1)}%)`);
  
  console.log('\n📋 Citizenship Distribution:');
  Object.entries(citizenCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([citizen, count]) => {
      const percentage = ((count/withCitizen)*100).toFixed(1);
      const status = citizen === 'true' ? 'Citizens' : 'Non-Citizens';
      console.log(`  ${status}: ${count} employees (${percentage}%)`);
    });
  
  // Show samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, ic_no, citizen')
    .not('citizen', 'is', null)
    .limit(10);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees:');
    samples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    IC: ${emp.ic_no || 'N/A'} | Citizen: ${emp.citizen}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Citizenship Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const citizenData = await processFiles();
  
  if (citizenData.size === 0) {
    console.log('\n⚠️  No citizenship data found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found citizenship data for ${citizenData.size} employees`);
  
  // Update database
  await updateDatabase(citizenData);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}