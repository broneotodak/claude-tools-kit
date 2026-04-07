#!/usr/bin/env node

/**
 * Fix demographic fields in master_hr2000 table
 * Extracts race, religion, marital_status from raw data
 * Gender will be inferred from IC number (odd = male, even = female)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Infer gender from IC number (last digit: odd = male, even = female)
function inferGenderFromIC(icNo) {
  if (!icNo || typeof icNo !== 'string') return null;
  
  // Remove all non-digits
  const digits = icNo.replace(/\D/g, '');
  
  if (digits.length < 12) return null;
  
  // Get last digit
  const lastDigit = parseInt(digits[digits.length - 1]);
  
  if (isNaN(lastDigit)) return null;
  
  // Odd = Male, Even = Female
  return lastDigit % 2 === 1 ? 'MALE' : 'FEMALE';
}

// Extract demographic data from CSV
function extractFromCSV(lines, startIdx) {
  const data = {
    race: null,
    religion: null,
    marital_status: null,
    ic_no: null
  };
  
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    
    // Get IC number for gender inference
    if (line.includes('I/C No. (New)')) {
      const parts = line.split(',');
      if (parts[3] && parts[3].trim()) {
        data.ic_no = parts[3].trim();
      }
    }
    
    // Get race
    if (line.includes('Race')) {
      const parts = line.split(',');
      if (parts[8] && parts[8].trim() && parts[8].trim() !== 'Race') {
        data.race = parts[8].trim().toUpperCase();
      }
    }
    
    // Get religion
    if (line.includes('Religion')) {
      const parts = line.split(',');
      if (parts[8] && parts[8].trim() && parts[8].trim() !== 'Religion') {
        data.religion = parts[8].trim().toUpperCase();
      }
    }
    
    // Get marital status
    if (line.includes('Marital Status')) {
      const parts = line.split(',');
      if (parts[8] && parts[8].trim() && parts[8].trim() !== 'Marital Status') {
        data.marital_status = parts[8].trim().toUpperCase();
      }
    }
  }
  
  return data;
}

// Extract demographic data from TXT
function extractFromTXT(lines, startIdx) {
  const data = {
    race: null,
    religion: null,
    marital_status: null,
    ic_no: null
  };
  
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    
    // Get IC number
    if (line.includes('I/C No. (New)')) {
      const match = line.match(/I\/C No\. \(New\)\s+([\d-]+)/);
      if (match) {
        data.ic_no = match[1];
      }
    }
    
    // Get race
    if (line.includes('Race') && !line.includes('Passport')) {
      const match = line.match(/Race\s+([A-Z]+)(?:\s|$)/);
      if (match) {
        data.race = match[1];
      }
    }
    
    // Get religion
    if (line.includes('Religion')) {
      const match = line.match(/Religion\s+([A-Z]+)(?:\s|$)/);
      if (match) {
        data.religion = match[1];
      }
    }
    
    // Get marital status
    if (line.includes('Marital Status')) {
      const match = line.match(/Marital Status\s+([A-Z\s]+?)(?:\s{2,}|$)/);
      if (match) {
        data.marital_status = match[1].trim();
      }
    }
  }
  
  return data;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const demographicsMap = new Map();
  
  // Process CSV files first
  console.log('📊 Processing CSV files for demographic data...\n');
  
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
      
      if (currentEmployee && (line.includes('Race') || line.includes('Religion') || line.includes('Marital'))) {
        const data = extractFromCSV(lines, i - 5); // Look back a few lines
        if (data.race || data.religion || data.marital_status || data.ic_no) {
          // Add gender inference
          data.gender = inferGenderFromIC(data.ic_no);
          demographicsMap.set(currentEmployee, data);
          console.log(`  ✓ ${currentEmployee}:`);
          if (data.race) console.log(`    Race: ${data.race}`);
          if (data.religion) console.log(`    Religion: ${data.religion}`);
          if (data.marital_status) console.log(`    Marital: ${data.marital_status}`);
          if (data.gender) console.log(`    Gender: ${data.gender} (inferred)`);
          console.log('');
        }
      }
    }
  }
  
  // Process TXT files for missing data
  console.log('\n📊 Processing TXT files for additional demographic data...\n');
  
  const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
  for (const file of txtFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('Employee No.')) {
        let employeeNo = null;
        const directMatch = line.match(/Employee No\.\s+([A-Z]+\d+)/);
        
        if (directMatch) {
          employeeNo = directMatch[1];
        } else if (line.includes('Employee No.')) {
          for (let k = i + 1; k < Math.min(i + 5, lines.length); k++) {
            const nextLine = lines[k].trim();
            if (nextLine && nextLine.match(/^[A-Z]+\d+$/)) {
              employeeNo = nextLine;
              break;
            }
          }
        }
        
        if (employeeNo && !demographicsMap.has(employeeNo)) {
          const data = extractFromTXT(lines, i);
          if (data.race || data.religion || data.marital_status || data.ic_no) {
            data.gender = inferGenderFromIC(data.ic_no);
            demographicsMap.set(employeeNo, data);
            console.log(`  ✓ ${employeeNo} (from TXT):`);
            if (data.race) console.log(`    Race: ${data.race}`);
            if (data.religion) console.log(`    Religion: ${data.religion}`);
            if (data.marital_status) console.log(`    Marital: ${data.marital_status}`);
            if (data.gender) console.log(`    Gender: ${data.gender} (inferred)`);
            console.log('');
          }
        }
      }
    }
  }
  
  return demographicsMap;
}

// Update database
async function updateDatabase(demographicsMap) {
  console.log(`\n💾 Updating demographic data for ${demographicsMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Update in batches
  const entries = Array.from(demographicsMap.entries());
  
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const [employee_no, data] of batch) {
      const updateData = {};
      
      if (data.race) updateData.race = data.race;
      if (data.religion) updateData.religion = data.religion;
      if (data.marital_status) updateData.marital_status = data.marital_status;
      if (data.gender) updateData.gender = data.gender;
      
      if (Object.keys(updateData).length > 0) {
        const { error } = await supabase
          .from('master_hr2000')
          .update(updateData)
          .eq('employee_no', employee_no);
        
        if (!error) {
          updated++;
          if (updated % 50 === 0) {
            console.log(`  ✓ Updated ${updated} records...`);
          }
        } else {
          errors++;
          console.error(`  ❌ Error updating ${employee_no}: ${error.message}`);
        }
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
  console.log('\n🔍 Verifying demographic data...\n');
  
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  // Get counts for each field
  const { count: withRace } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('race', 'is', null);
  
  const { count: withReligion } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('religion', 'is', null);
  
  const { count: withMarital } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('marital_status', 'is', null);
  
  const { count: withGender } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('gender', 'is', null);
  
  console.log('📊 Demographic Field Statistics:');
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With race: ${withRace} (${((withRace/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With religion: ${withReligion} (${((withReligion/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With marital status: ${withMarital} (${((withMarital/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With gender: ${withGender} (${((withGender/totalCount)*100).toFixed(1)}%)`);
  
  // Get distributions
  const { data: raceData } = await supabase
    .from('master_hr2000')
    .select('race')
    .not('race', 'is', null);
  
  const raceCount = {};
  raceData?.forEach(row => {
    const race = row.race;
    raceCount[race] = (raceCount[race] || 0) + 1;
  });
  
  console.log('\n📋 Race Distribution:');
  Object.entries(raceCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([race, count]) => {
      console.log(`  ${race}: ${count} employees`);
    });
  
  const { data: genderData } = await supabase
    .from('master_hr2000')
    .select('gender')
    .not('gender', 'is', null);
  
  const genderCount = {};
  genderData?.forEach(row => {
    const gender = row.gender;
    genderCount[gender] = (genderCount[gender] || 0) + 1;
  });
  
  console.log('\n📋 Gender Distribution:');
  Object.entries(genderCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([gender, count]) => {
      const percentage = ((count/withGender)*100).toFixed(1);
      console.log(`  ${gender}: ${count} employees (${percentage}%)`);
    });
  
  // Show samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, race, religion, marital_status, gender')
    .not('race', 'is', null)
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees:');
    samples.forEach(emp => {
      console.log(`\n  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    Race: ${emp.race || 'N/A'} | Religion: ${emp.religion || 'N/A'}`);
      console.log(`    Marital: ${emp.marital_status || 'N/A'} | Gender: ${emp.gender || 'N/A'}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Demographics Fix Tool\n');
  console.log('=' .repeat(60));
  console.log('\nThis tool will:');
  console.log('- Extract race, religion, and marital status from raw data');
  console.log('- Infer gender from IC number (odd = male, even = female)\n');
  console.log('=' .repeat(60) + '\n');
  
  // Process files
  const demographicsMap = await processFiles();
  
  if (demographicsMap.size === 0) {
    console.log('\n⚠️  No demographic data found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found demographic data for ${demographicsMap.size} employees`);
  
  // Update database
  await updateDatabase(demographicsMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}