#!/usr/bin/env node

/**
 * Fix confirmation dates in master_hr2000 table
 * Extracts confirmation dates from both CSV and TXT raw files
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse date string to ISO format
function parseDate(dateStr) {
  if (!dateStr || dateStr === '/ /' || dateStr === '/' || dateStr.trim() === '') {
    return null;
  }
  
  // Remove any quotes and trim
  const cleaned = dateStr.replace(/['"]/g, '').trim();
  
  // Parse DD/MM/YYYY format
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

// Extract confirmation date from CSV line structure
function extractConfirmDateFromCSV(lines, startIdx) {
  // In CSV, confirmation date appears after "Previous Basic" line
  // Format: Previous Basic,,,RM,"X,XXX.XX",,,Confirm Date,,,,DD/MM/YYYY,,
  
  for (let i = startIdx; i < Math.min(startIdx + 20, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Confirm Date')) {
      const parts = line.split(',');
      // Confirm Date is typically at index 11 or 12
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

// Extract confirmation date from TXT format
function extractConfirmDateFromTXT(lines, startIdx) {
  // In TXT, format is: Previous Basic  RMX,XXX.XX                   Confirm Date DD/MM/YYYY
  
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('Confirm Date')) {
      // Extract date after "Confirm Date"
      const match = line.match(/Confirm Date\s+(\d{2}\/\d{2}\/\d{4})/);
      if (match) {
        return parseDate(match[1]);
      }
      
      // Alternative: split by spaces and get last part
      const parts = line.split(/\s+/);
      const lastPart = parts[parts.length - 1];
      if (lastPart.match(/\d{2}\/\d{2}\/\d{4}/)) {
        return parseDate(lastPart);
      }
    }
  }
  
  return null;
}

// Process CSV file
async function processCSVFile(filePath, orgCode) {
  console.log(`\n📄 Processing CSV: ${path.basename(filePath)}`);
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const updates = [];
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
    
    // Extract confirmation date
    if (currentEmployee && line.includes('Confirm Date')) {
      const confirmDate = extractConfirmDateFromCSV(lines, i);
      if (confirmDate) {
        updates.push({
          employee_no: currentEmployee,
          confirmation_date: confirmDate
        });
        console.log(`  ✓ ${currentEmployee}: ${confirmDate}`);
      }
    }
  }
  
  return updates;
}

// Process TXT file
async function processTXTFile(filePath, orgCode) {
  console.log(`\n📄 Processing TXT: ${path.basename(filePath)}`);
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const updates = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for employee number
    if (line.includes('Employee No.')) {
      const match = line.match(/Employee No\.\s+([A-Z]+\d+)/);
      if (match) {
        const employeeNo = match[1];
        const confirmDate = extractConfirmDateFromTXT(lines, i);
        
        if (confirmDate) {
          updates.push({
            employee_no: employeeNo,
            confirmation_date: confirmDate
          });
          console.log(`  ✓ ${employeeNo}: ${confirmDate}`);
        }
      }
    }
  }
  
  return updates;
}

// Update database
async function updateDatabase(updates) {
  console.log(`\n💾 Updating ${updates.length} confirmation dates in database...`);
  
  let updated = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from('master_hr2000')
      .update({ confirmation_date: update.confirmation_date })
      .eq('employee_no', update.employee_no);
    
    if (!error) {
      updated++;
    } else {
      console.error(`  ❌ Error updating ${update.employee_no}: ${error.message}`);
    }
  }
  
  console.log(`✅ Updated ${updated} records`);
  return updated;
}

// Main process
async function main() {
  console.log('🔧 THR Confirmation Date Fix Tool\n');
  console.log('=' .repeat(60));
  
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  
  // Get all CSV and TXT files
  const files = fs.readdirSync(rawDataPath);
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
  
  console.log(`\nFound ${csvFiles.length} CSV files and ${txtFiles.length} TXT files`);
  
  const allUpdates = [];
  
  // Process CSV files
  console.log('\n📊 Processing CSV files...');
  for (const file of csvFiles) {
    const orgCode = file.split('_')[0];
    const updates = await processCSVFile(path.join(rawDataPath, file), orgCode);
    allUpdates.push(...updates);
  }
  
  // Process TXT files
  console.log('\n📊 Processing TXT files...');
  for (const file of txtFiles) {
    const orgCode = file.split('_')[0];
    const updates = await processTXTFile(path.join(rawDataPath, file), orgCode);
    
    // Merge with CSV data (TXT takes precedence)
    updates.forEach(txtUpdate => {
      const existing = allUpdates.find(u => u.employee_no === txtUpdate.employee_no);
      if (existing) {
        existing.confirmation_date = txtUpdate.confirmation_date;
      } else {
        allUpdates.push(txtUpdate);
      }
    });
  }
  
  // Remove duplicates and null dates
  const uniqueUpdates = allUpdates.filter(u => u.confirmation_date !== null);
  
  console.log(`\n📋 Summary:`);
  console.log(`  Total employees with confirmation dates: ${uniqueUpdates.length}`);
  
  // Update database
  const totalUpdated = await updateDatabase(uniqueUpdates);
  
  // Verify
  console.log('\n🔍 Verifying update...');
  const { count: withDates } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('confirmation_date', 'is', null);
  
  const { count: total } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n✅ Complete!`);
  console.log(`  Confirmation dates: ${withDates}/${total} (${((withDates/total)*100).toFixed(1)}%)`);
}

if (require.main === module) {
  main().catch(console.error);
}