#!/usr/bin/env node

/**
 * Fix section in master_hr2000 table
 * Extracts section/department subdivision from raw data
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Normalize section values
function normalizeSection(section) {
  if (!section) return null;
  
  // Clean up the section name
  const cleaned = section.trim().toUpperCase();
  
  // Skip if it looks like noise (Bank Account No patterns)
  if (cleaned.includes('BANK ACCOUNT NO') || cleaned.match(/^\d+$/)) {
    return null;
  }
  
  // Map common variations
  const mappings = {
    'CEO OFFICE': 'CEO OFFICE',
    "CEO'S OFFICE": 'CEO OFFICE',
    'OPERATIONS': 'OPERATIONS',
    'OPERATION': 'OPERATIONS',
    'MANAGEMENT & OPERATION': 'MANAGEMENT & OPERATIONS',
    'MANAGEMENT (ESPORT)': 'ESPORTS MANAGEMENT',
    'E-SPORTS DEVELOPMENT': 'ESPORTS DEVELOPMENT',
    'MANAGEMENT (FINANCE & HR)': 'FINANCE & HR',
    'FINANCE DEPARTMENT': 'FINANCE',
    'HUMAN RESOURCES': 'HUMAN RESOURCES',
    'SALES': 'SALES',
    'SALES & SERVICES': 'SALES & SERVICES',
    'SALES & MARKETING': 'SALES & MARKETING',
    'MARKETING': 'MARKETING',
    'BUSINESS DEVELOPMENT': 'BUSINESS DEVELOPMENT',
    'GAME DEVELOPMENT': 'GAME DEVELOPMENT',
    'PROJECT DEVELOPMENT': 'PROJECT DEVELOPMENT',
    'CONTENT DEVELOPMENT': 'CONTENT DEVELOPMENT',
    'DIGITAL TRANSFORMATION': 'DIGITAL TRANSFORMATION',
    'CREATIVE DESIGN': 'CREATIVE DESIGN',
    'TECHNICAL IT & ASSETS': 'IT & ASSETS',
    'SYSTEM & DATA MANAGEMENT': 'SYSTEM & DATA MANAGEMENT',
    'WAREHOUSE & INVENTORY MANAGEMENT': 'WAREHOUSE & INVENTORY',
    'TODAK KIDS': 'TODAK KIDS',
    'ACADEMIC AFFAIR': 'ACADEMIC AFFAIRS',
    'MANAGEMENT': 'MANAGEMENT',
    'LEGAL': 'LEGAL',
    'DIRECTOR': null,  // This is a role, not a section
    'CEO': null,       // This is a role, not a section
    'MANAGER': null,   // This is a role, not a section
    'EXECUTIVE': null, // This is a role, not a section
    'ASSISTANT': null  // This is a role, not a section
  };
  
  // Return mapped value or cleaned value
  if (mappings.hasOwnProperty(cleaned)) {
    return mappings[cleaned];
  }
  
  return cleaned;
}

// Extract section from CSV
function extractSectionFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Section')) {
      const parts = line.split(',');
      // Section value is at index 12 (13th column)
      if (parts[12] && parts[12].trim() && parts[12].trim() !== '') {
        return normalizeSection(parts[12].trim());
      }
    }
  }
  return null;
}

// Extract section from TXT
function extractSectionFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Section') && !line.includes('Bank Account No')) {
      // Extract text after "Section"
      const match = line.match(/Section\s+([A-Z][A-Z\s&()/-]+?)(?:\s{2,}|$)/);
      if (match) {
        return normalizeSection(match[1]);
      }
      
      // Alternative: if Section appears at end of line
      const parts = line.split('Section');
      if (parts.length > 1) {
        const section = parts[parts.length - 1].trim();
        if (section && section.length > 0 && !section.includes('Bank Account')) {
          return normalizeSection(section);
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
  
  const sectionData = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for sections...\n');
  
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
      
      if (currentEmployee && line.includes('Section')) {
        const section = extractSectionFromCSV(lines, i);
        if (section) {
          sectionData.set(currentEmployee, section);
          console.log(`  ✓ ${currentEmployee}: ${section}`);
        }
      }
    }
  }
  
  // Process TXT files to get more sections
  console.log('\n📊 Processing TXT files for sections...\n');
  
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
          const section = extractSectionFromTXT(lines, i);
          
          if (section && !sectionData.has(employeeNo)) {
            sectionData.set(employeeNo, section);
            console.log(`  ✓ ${employeeNo}: ${section} (from TXT)`);
          }
        }
      }
    }
  }
  
  return sectionData;
}

// Update database
async function updateDatabase(sectionData) {
  console.log(`\n💾 Updating sections for ${sectionData.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(sectionData.entries()).map(([employee_no, section]) => ({
    employee_no,
    section
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ section: update.section })
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
  console.log('\n🔍 Verifying section data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withSection } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('section', 'is', null);
  
  // Get section distribution
  const { data: distribution } = await supabase
    .from('master_hr2000')
    .select('section')
    .not('section', 'is', null);
  
  const sectionCount = {};
  distribution.forEach(row => {
    const sec = row.section;
    sectionCount[sec] = (sectionCount[sec] || 0) + 1;
  });
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With section: ${withSection} (${((withSection/totalCount)*100).toFixed(1)}%)`);
  
  console.log('\n📋 Section Distribution:');
  Object.entries(sectionCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([section, count]) => {
      console.log(`  ${section}: ${count} employees`);
    });
  
  // Show samples with department vs section
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, department, section')
    .not('section', 'is', null)
    .limit(10);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees (Department → Section):');
    samples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    ${emp.department || 'N/A'} → ${emp.section}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Section Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const sectionData = await processFiles();
  
  if (sectionData.size === 0) {
    console.log('\n⚠️  No sections found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found sections for ${sectionData.size} employees`);
  
  // Update database
  await updateDatabase(sectionData);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}