#!/usr/bin/env node

/**
 * Fix grade in master_hr2000 table
 * Extracts job grade from raw data
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Normalize grade values
function normalizeGrade(grade) {
  if (!grade) return null;
  
  // Clean and uppercase
  const cleaned = grade.trim().toUpperCase();
  
  // Skip empty values
  if (cleaned === '' || cleaned === 'JOB GRADE') {
    return null;
  }
  
  // Common grade mappings
  const mappings = {
    'DIRECTOR': 'DIRECTOR',
    'EXECUTIVE': 'EXECUTIVE',
    'MANAGER': 'MANAGER',
    'ASSISTANT': 'ASSISTANT',
    'C1': 'C1',  // CEO level
    'C2': 'C2',  // COO level
    'C3': 'C3',  // CFO level
    'D1': 'D1',  // Director level
    'M1': 'M1',  // Manager level 1
    'M2': 'M2',  // Manager level 2
    'SM1': 'SM1', // Senior Manager
    'SE1': 'SE1', // Senior Executive
    'SE2': 'SE2', // Senior Executive 2
    'E1': 'E1',  // Executive level 1
    'E2': 'E2',  // Executive level 2
    'E3': 'E3',  // Executive level 3
    'A1': 'A1',  // Assistant level 1
    'A2': 'A2',  // Assistant level 2
    'N1': 'N1',  // Non-executive level 1
    'N2': 'N2'   // Non-executive level 2
  };
  
  // Return mapped value or cleaned value
  return mappings[cleaned] || cleaned;
}

// Extract job grade from CSV
function extractGradeFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Job Grade')) {
      const parts = line.split(',');
      // Job Grade value is at index 12 (13th column)
      if (parts[12] && parts[12].trim() && parts[12].trim() !== '') {
        return normalizeGrade(parts[12].trim());
      }
    }
  }
  return null;
}

// Extract job grade from TXT
function extractGradeFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Job Grade')) {
      // Extract text after "Job Grade"
      const match = line.match(/Job Grade\s+([A-Z0-9]+)(?:\s|$)/);
      if (match) {
        return normalizeGrade(match[1]);
      }
      
      // Alternative: split by "Job Grade"
      const parts = line.split('Job Grade');
      if (parts.length > 1) {
        const grade = parts[parts.length - 1].trim().split(/\s+/)[0];
        if (grade && grade.length > 0) {
          return normalizeGrade(grade);
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
  
  const gradeData = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for job grades...\n');
  
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
      
      if (currentEmployee && line.includes('Job Grade')) {
        const grade = extractGradeFromCSV(lines, i);
        if (grade) {
          gradeData.set(currentEmployee, grade);
          console.log(`  ✓ ${currentEmployee}: ${grade}`);
        }
      }
    }
  }
  
  // Process TXT files to get more grades
  console.log('\n📊 Processing TXT files for job grades...\n');
  
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
          const grade = extractGradeFromTXT(lines, i);
          
          if (grade && !gradeData.has(employeeNo)) {
            gradeData.set(employeeNo, grade);
            console.log(`  ✓ ${employeeNo}: ${grade} (from TXT)`);
          }
        }
      }
    }
  }
  
  return gradeData;
}

// Update database
async function updateDatabase(gradeData) {
  console.log(`\n💾 Updating job grades for ${gradeData.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(gradeData.entries()).map(([employee_no, grade]) => ({
    employee_no,
    grade
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ grade: update.grade })
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
  console.log('\n🔍 Verifying job grade data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withGrade } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('grade', 'is', null);
  
  // Get grade distribution
  const { data: distribution } = await supabase
    .from('master_hr2000')
    .select('grade')
    .not('grade', 'is', null);
  
  const gradeCount = {};
  distribution.forEach(row => {
    const grade = row.grade;
    gradeCount[grade] = (gradeCount[grade] || 0) + 1;
  });
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With job grade: ${withGrade} (${((withGrade/totalCount)*100).toFixed(1)}%)`);
  
  console.log('\n📋 Grade Distribution:');
  Object.entries(gradeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([grade, count]) => {
      console.log(`  ${grade}: ${count} employees`);
    });
  
  // Show samples comparing category, designation, and grade
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, staff_category, designation, grade')
    .not('grade', 'is', null)
    .limit(10);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees (Category | Grade | Designation):');
    samples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    ${emp.staff_category || 'N/A'} | ${emp.grade} | ${emp.designation || 'N/A'}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Job Grade Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const gradeData = await processFiles();
  
  if (gradeData.size === 0) {
    console.log('\n⚠️  No job grades found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found job grades for ${gradeData.size} employees`);
  
  // Update database
  await updateDatabase(gradeData);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}