#!/usr/bin/env node

/**
 * Fix allowances in master_hr2000 table
 * Extracts individual allowances and stores as JSONB array
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse amount from format: "1,000.00" or "500.00"
function parseAmount(amountStr) {
  if (!amountStr || amountStr.trim() === '') {
    return null;
  }
  
  // Remove commas and convert to number
  const cleaned = amountStr.replace(/,/g, '');
  const amount = parseFloat(cleaned);
  
  if (isNaN(amount)) {
    return null;
  }
  
  return amount;
}

// Extract allowances from CSV
function extractAllowancesFromCSV(lines, startIdx) {
  const allowances = [];
  let inAllowanceSection = false;
  
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if we're in the allowance/deduction section
    if (line.includes('Fixed Allowance / Deduction')) {
      inAllowanceSection = true;
      continue;
    }
    
    // Stop if we hit the next employee
    if (line.includes('Employee No.') && i > startIdx + 10) {
      break;
    }
    
    // Process allowance lines (numbered lines like "1,COVERING,...")
    if (inAllowanceSection && line.match(/^\d+,/)) {
      const parts = line.split(',');
      
      // Expected format: [number, code, description, empty, empty, empty, amount, empty, empty, period, start_date, empty, empty, end_date]
      if (parts.length >= 14 && parts[1] && parts[2] && parts[6]) {
        const code = parts[1].trim();
        const description = parts[2].trim();
        const amount = parseAmount(parts[6]);
        const period = parts[9] ? parts[9].trim() : null;
        const startDate = parts[10] ? parts[10].trim() : null;
        const endDate = parts[13] ? parts[13].trim() : null;
        
        // Only include positive amounts (allowances, not deductions like ZAKAT)
        if (amount && amount > 0 && description.includes('ALLOWANCE')) {
          allowances.push({
            code: code,
            description: description,
            amount: amount,
            period: period,
            start_date: startDate,
            end_date: endDate
          });
        }
      }
    }
  }
  
  return allowances;
}

// Extract allowances from TXT (similar format but different parsing)
function extractAllowancesFromTXT(lines, startIdx) {
  const allowances = [];
  let inAllowanceSection = false;
  
  for (let i = startIdx; i < Math.min(startIdx + 100, lines.length); i++) {
    const line = lines[i];
    
    // Check if we're in the allowance section
    if (line.includes('Fixed Allowance / Deduction')) {
      inAllowanceSection = true;
      continue;
    }
    
    // Stop if we hit the next employee
    if (line.includes('Employee No.') && i > startIdx + 20) {
      break;
    }
    
    // Process allowance lines in TXT format
    if (inAllowanceSection && line.trim() && line.match(/^\s*\d+\s+/)) {
      // TXT format is more free-form, need to parse carefully
      // Example: "1 COVERING COVERING ALLOWANCE         500.00  END    02/2023         06/2023"
      
      // Split by multiple spaces to get fields
      const parts = line.trim().split(/\s{2,}/);
      
      if (parts.length >= 4) {
        // First part has number and code
        const firstPart = parts[0].trim();
        const match = firstPart.match(/^\d+\s+(\w+)$/);
        
        if (match) {
          const code = match[1];
          const description = parts[1] ? parts[1].trim() : '';
          const amountStr = parts[2] ? parts[2].trim() : '';
          const amount = parseAmount(amountStr);
          
          // Look for period and dates in remaining parts
          let period = null;
          let startDate = null;
          let endDate = null;
          
          for (let j = 3; j < parts.length; j++) {
            const part = parts[j].trim();
            if (part === 'END' || part === 'START') {
              period = part;
            } else if (part.match(/^\d{2}\/\d{4}$/)) {
              if (!startDate) {
                startDate = part;
              } else {
                endDate = part;
              }
            }
          }
          
          // Only include positive amounts and allowances
          if (amount && amount > 0 && description.includes('ALLOWANCE')) {
            allowances.push({
              code: code,
              description: description,
              amount: amount,
              period: period,
              start_date: startDate,
              end_date: endDate
            });
          }
        }
      }
    }
  }
  
  return allowances;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const allowancesMap = new Map();
  
  // Process CSV files first
  console.log('📊 Processing CSV files for allowances data...\n');
  
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  for (const file of csvFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let currentEmployee = null;
    let pendingAllowances = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for allowance lines (numbered lines like "1,COVERING,...")
      if (line.match(/^\d+,/) && (line.includes('ALLOWANCE') || line.includes('ZAKAT'))) {
        const parts = line.split(',');
        
        // Expected format: [number, code, description, empty, empty, amount or empty, amount if col6, ...]
        if (parts.length >= 14) {
          const code = parts[1] ? parts[1].trim() : '';
          const description = parts[2] ? parts[2].trim() : '';
          // Amount can be in column 5 or 6 depending on format
          const amount = parseAmount(parts[6]) || parseAmount(parts[5]);
          const period = parts[9] ? parts[9].trim() : null;
          const startDate = parts[10] ? parts[10].trim() : null;
          const endDate = parts[13] ? parts[13].trim() : null;
          
          // Only include positive amounts (allowances, not deductions like ZAKAT)
          if (amount && amount > 0 && description.includes('ALLOWANCE')) {
            pendingAllowances.push({
              code: code,
              description: description,
              amount: amount,
              period: period,
              start_date: startDate,
              end_date: endDate
            });
          }
        }
      }
      
      // When we hit Employee No., assign pending allowances to this employee
      if (line.startsWith('Employee No.')) {
        const parts = line.split(',');
        if (parts[3]) {
          currentEmployee = parts[3].trim();
          
          if (pendingAllowances.length > 0 && currentEmployee) {
            allowancesMap.set(currentEmployee, pendingAllowances);
            console.log(`  ✓ ${currentEmployee}: ${pendingAllowances.length} allowance(s)`);
            pendingAllowances.forEach(a => {
              console.log(`    - ${a.description}: RM ${a.amount}`);
            });
            console.log('');
            
            // Reset for next employee
            pendingAllowances = [];
          }
        }
      }
    }
  }
  
  // Process TXT files for any missing data
  console.log('\n📊 Processing TXT files for additional allowances...\n');
  
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
        
        if (employeeNo && !allowancesMap.has(employeeNo)) {
          // Look for allowances within next 100 lines
          for (let j = i; j < Math.min(i + 100, lines.length); j++) {
            if (lines[j].includes('Fixed Allowance')) {
              const allowances = extractAllowancesFromTXT(lines, j);
              if (allowances.length > 0) {
                allowancesMap.set(employeeNo, allowances);
                console.log(`  ✓ ${employeeNo}: ${allowances.length} allowance(s) (from TXT)`);
                allowances.forEach(a => {
                  console.log(`    - ${a.description}: RM ${a.amount}`);
                });
                console.log('');
              }
              break;
            }
          }
        }
      }
    }
  }
  
  return allowancesMap;
}

// Update database
async function updateDatabase(allowancesMap) {
  console.log(`\n💾 Updating allowances for ${allowancesMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Update in batches
  const entries = Array.from(allowancesMap.entries());
  
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const [employee_no, allowances] of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ allowances: allowances })
        .eq('employee_no', employee_no);
      
      if (!error) {
        updated++;
        if (updated % 20 === 0) {
          console.log(`  ✓ Updated ${updated} records...`);
        }
      } else {
        errors++;
        console.error(`  ❌ Error updating ${employee_no}: ${error.message}`);
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
  console.log('\n🔍 Verifying allowances data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withAllowances } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('allowances', 'is', null);
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With allowances: ${withAllowances} (${((withAllowances/totalCount)*100).toFixed(1)}%)`);
  
  // Get samples with allowances
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, allowances')
    .not('allowances', 'is', null)
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees with allowances:');
    samples.forEach(emp => {
      console.log(`\n  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      if (Array.isArray(emp.allowances)) {
        emp.allowances.forEach(allowance => {
          console.log(`    - ${allowance.description}: RM ${allowance.amount}`);
          console.log(`      Period: ${allowance.start_date || 'N/A'} to ${allowance.end_date || 'N/A'}`);
        });
        const total = emp.allowances.reduce((sum, a) => sum + (a.amount || 0), 0);
        console.log(`    💰 Total: RM ${total.toFixed(2)}`);
      }
    });
  }
  
  // Count total allowance types
  const { data: allAllowances } = await supabase
    .from('master_hr2000')
    .select('allowances')
    .not('allowances', 'is', null);
  
  const allowanceTypes = {};
  let totalAllowanceCount = 0;
  
  allAllowances?.forEach(row => {
    if (Array.isArray(row.allowances)) {
      row.allowances.forEach(allowance => {
        totalAllowanceCount++;
        const type = allowance.description || 'Unknown';
        allowanceTypes[type] = (allowanceTypes[type] || 0) + 1;
      });
    }
  });
  
  console.log(`\n📋 Allowance Type Distribution:`);
  console.log(`  Total allowance entries: ${totalAllowanceCount}`);
  Object.entries(allowanceTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count} entries`);
    });
}

// Main
async function main() {
  console.log('🔧 THR Allowances Migration Tool\n');
  console.log('=' .repeat(60));
  console.log('\nThis tool will:');
  console.log('- Extract individual allowances from raw data');
  console.log('- Store them as JSONB array in the allowances column');
  console.log('- Preserve all details (code, description, amount, dates)\n');
  console.log('=' .repeat(60) + '\n');
  
  // Process files
  const allowancesMap = await processFiles();
  
  if (allowancesMap.size === 0) {
    console.log('\n⚠️  No allowances found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found allowances for ${allowancesMap.size} employees`);
  
  // Update database
  await updateDatabase(allowancesMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}