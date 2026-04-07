#!/usr/bin/env node

/**
 * Fix staff_category in master_hr2000 table
 * Extracts job levels/grades from raw data Category field
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Normalize category values
function normalizeCategory(category) {
  if (!category) return null;
  
  // Clean and uppercase
  const cleaned = category.trim().toUpperCase();
  
  // Map variations to standard values
  const mappings = {
    'E': 'EXECUTIVE',
    'M': 'MANAGER',
    'S': 'SENIOR EXECUTIVE',
    'D': 'DIRECTOR',
    'T': 'TEAM LEADER',
    'EXECUTIVE': 'EXECUTIVE',
    'MANAGER': 'MANAGER',
    'ASSISTANT': 'ASSISTANT',
    'SENIOR EXECUTIVE': 'SENIOR EXECUTIVE',
    'ASSISTANT MANAGER': 'ASSISTANT MANAGER',
    'NON EXECUTIVE': 'NON EXECUTIVE',
    'DIRECTOR': 'DIRECTOR',
    'CEO': 'CEO',
    'COO': 'COO',
    'CFO': 'CFO',
    'CHIEF EXECUTIVE OFFICER': 'CEO',
    'TEAM LEADER': 'TEAM LEADER',
    'SENIOR MANAGER': 'SENIOR MANAGER'
  };
  
  return mappings[cleaned] || cleaned;
}

// Extract category from CSV
function extractCategoryFromCSV(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Category')) {
      const parts = line.split(',');
      // Category is typically at index 13
      if (parts[13] && parts[13].trim() && parts[13].trim() !== 'Category') {
        return normalizeCategory(parts[13].trim());
      }
    }
  }
  return null;
}

// Extract category from TXT
function extractCategoryFromTXT(lines, startIdx) {
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Category') && !line.includes('Category Category')) {
      // Extract text after "Category"
      const match = line.match(/Category\s+([A-Z][A-Z\s]+?)(?:\s{2,}|$)/);
      if (match) {
        return normalizeCategory(match[1]);
      }
      
      // Alternative: split and take last part
      const parts = line.split('Category');
      if (parts.length > 1) {
        const category = parts[parts.length - 1].trim();
        if (category && category.length > 0) {
          return normalizeCategory(category);
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
  
  const categoryData = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for staff categories...\n');
  
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
      
      if (currentEmployee && line.includes('Category')) {
        const category = extractCategoryFromCSV(lines, i);
        if (category) {
          categoryData.set(currentEmployee, category);
          console.log(`  ✓ ${currentEmployee}: ${category}`);
        }
      }
    }
  }
  
  // Process TXT files to verify or add more categories
  console.log('\n📊 Processing TXT files for staff categories...\n');
  
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
          const category = extractCategoryFromTXT(lines, i);
          
          if (category && !categoryData.has(employeeNo)) {
            categoryData.set(employeeNo, category);
            console.log(`  ✓ ${employeeNo}: ${category} (from TXT)`);
          }
        }
      }
    }
  }
  
  return categoryData;
}

// Update database
async function updateDatabase(categoryData) {
  console.log(`\n💾 Updating staff categories for ${categoryData.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Batch update for better performance
  const updates = Array.from(categoryData.entries()).map(([employee_no, category]) => ({
    employee_no,
    staff_category: category
  }));
  
  // Update in batches of 50
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ staff_category: update.staff_category })
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
  console.log('\n🔍 Verifying staff_category data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withCategory } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('staff_category', 'is', null);
  
  // Get category distribution
  const { data: distribution } = await supabase
    .from('master_hr2000')
    .select('staff_category')
    .not('staff_category', 'is', null);
  
  const categoryCount = {};
  distribution.forEach(row => {
    const cat = row.staff_category;
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With staff category: ${withCategory} (${((withCategory/totalCount)*100).toFixed(1)}%)`);
  
  console.log('\n📋 Category Distribution:');
  Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count} employees`);
    });
  
  // Show samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, designation, staff_category')
    .not('staff_category', 'is', null)
    .limit(10);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees with categories:');
    samples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    Designation: ${emp.designation || 'N/A'} | Category: ${emp.staff_category}`);
    });
  }
}

// Main
async function main() {
  console.log('🔧 THR Staff Category Fix Tool\n');
  console.log('=' .repeat(60));
  
  // Process files
  const categoryData = await processFiles();
  
  if (categoryData.size === 0) {
    console.log('\n⚠️  No staff categories found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found categories for ${categoryData.size} employees`);
  
  // Update database
  await updateDatabase(categoryData);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}