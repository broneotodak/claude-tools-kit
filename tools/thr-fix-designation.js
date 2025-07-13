#!/usr/bin/env node

/**
 * Fix designation in master_hr2000 table
 * Extracts occupation/job title from raw data
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Normalize designation values
function normalizeDesignation(designation) {
  if (!designation) return null;
  
  // Clean and format properly
  const cleaned = designation.trim();
  
  // If it's already properly formatted, return as is
  if (cleaned.includes(' ')) {
    return cleaned;
  }
  
  // Convert all caps single words to title case
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

// Extract occupation from CSV
function extractOccupationFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Occupation')) {
      const parts = line.split(',');
      // Occupation value is at index 12 (13th column)
      if (parts[12] && parts[12].trim() && parts[12].trim() !== '') {
        return normalizeDesignation(parts[12].trim());
      }
    }
  }
  return null;
}

// Extract occupation from TXT
function extractOccupationFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Occupation') && !line.includes('Country')) {
      // Extract text after "Occupation"
      const match = line.match(/Occupation\s+(.+?)(?:\s{2,}|$)/);
      if (match) {
        return normalizeDesignation(match[1]);
      }
      
      // Alternative: split by "Occupation"
      const parts = line.split('Occupation');
      if (parts.length > 1) {
        const occupation = parts[parts.length - 1].trim();
        if (occupation && occupation.length > 0) {
          return normalizeDesignation(occupation);
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
  
  const designationData = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for designations...\n');
  
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
      
      if (currentEmployee && line.includes('Occupation')) {
        const occupation = extractOccupationFromCSV(lines, i);
        if (occupation) {
          designationData.set(currentEmployee, occupation);
          console.log(`  ✓ ${currentEmployee}: ${occupation}`);
        }
      }
    }
  }
  
  // Process TXT files to get more designations
  console.log('\n📊 Processing TXT files for designations...\n');
  
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
          const occupation = extractOccupationFromTXT(lines, i);
          
          if (occupation && !designationData.has(employeeNo)) {
            designationData.set(employeeNo, occupation);
            console.log(`  ✓ ${employeeNo}: ${occupation} (from TXT)`);
          }
        }
      }
    }
  }
  
  return designationData;
}

// Update database
async function updateDatabase(designationData) {
  console.log(`\n💾 Updating designations for ${designationData.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(designationData.entries()).map(([employee_no, designation]) => ({
    employee_no,
    designation
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ designation: update.designation })
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
  console.log('\n🔍 Verifying designation data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withDesignation } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('designation', 'is', null);
  
  // Get designation distribution
  const { data: distribution } = await supabase
    .from('master_hr2000')
    .select('designation')
    .not('designation', 'is', null);
  
  const designationCount = {};
  distribution.forEach(row => {
    const des = row.designation;
    designationCount[des] = (designationCount[des] || 0) + 1;
  });
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With designation: ${withDesignation} (${((withDesignation/totalCount)*100).toFixed(1)}%)`);
  
  console.log('\n📋 Top Designations:');
  Object.entries(designationCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([designation, count]) => {
      console.log(`  ${designation}: ${count} employees`);
    });
  
  // Show total unique designations
  console.log(`\nTotal unique designations: ${Object.keys(designationCount).length}`);
  
  // Show samples with category vs designation
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, staff_category, designation')
    .not('designation', 'is', null)
    .limit(10);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees (Category → Designation):');
    samples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    ${emp.staff_category || 'N/A'} → ${emp.designation}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Designation Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const designationData = await processFiles();
  
  if (designationData.size === 0) {
    console.log('\n⚠️  No designations found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found designations for ${designationData.size} employees`);
  
  // Update database
  await updateDatabase(designationData);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}