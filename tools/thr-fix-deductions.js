#!/usr/bin/env node

/**
 * Fix deductions in master_hr2000 table
 * Extracts fixed deductions and stores as JSONB array
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Parse amount from format: "-1,000.00" or "-50.00"
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
  
  // Return absolute value for deductions (they're stored as negative in source)
  return Math.abs(amount);
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const deductionsMap = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for deductions data...\n');
  
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  for (const file of csvFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let currentEmployee = null;
    let pendingDeductions = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for deduction lines (numbered lines with negative amounts)
      if (line.match(/^\d+,/)) {
        const parts = line.split(',');
        
        // Expected format: [number, code, description, empty, empty, amount or empty, amount if col6, ...]
        if (parts.length >= 14) {
          const code = parts[1] ? parts[1].trim() : '';
          const description = parts[2] ? parts[2].trim() : '';
          // Amount can be in column 5 or 6 depending on format
          let amount = parseAmount(parts[6]) || parseAmount(parts[5]);
          
          // Check if this is a negative amount (deduction)
          const amountStr = parts[6] || parts[5] || '';
          if (amountStr.includes('-')) {
            const period = parts[9] ? parts[9].trim() : null;
            const startDate = parts[10] ? parts[10].trim() : null;
            const endDate = parts[13] ? parts[13].trim() : null;
            
            // Common deduction types
            const deductionTypes = ['ZAKAT', 'PTPTN', 'LOAN', 'CP38', 'HOUSE', 'STAFF'];
            const isDeduction = deductionTypes.some(type => 
              code.toUpperCase().includes(type) || 
              description.toUpperCase().includes(type)
            );
            
            if (amount && isDeduction) {
              pendingDeductions.push({
                code: code,
                description: description,
                amount: amount, // Store as positive value
                period: period,
                start_date: startDate,
                end_date: endDate
              });
            }
          }
        }
      }
      
      // When we hit Employee No., assign pending deductions to this employee
      if (line.startsWith('Employee No.')) {
        const parts = line.split(',');
        if (parts[3]) {
          currentEmployee = parts[3].trim();
          
          if (pendingDeductions.length > 0 && currentEmployee) {
            deductionsMap.set(currentEmployee, pendingDeductions);
            console.log(`  ✓ ${currentEmployee}: ${pendingDeductions.length} deduction(s)`);
            pendingDeductions.forEach(d => {
              console.log(`    - ${d.description}: RM ${d.amount}`);
            });
            console.log('');
            
            // Reset for next employee
            pendingDeductions = [];
          }
        }
      }
    }
  }
  
  // Process TXT files for any missing data
  console.log('\n📊 Processing TXT files for additional deductions...\n');
  
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
        
        if (employeeNo && !deductionsMap.has(employeeNo)) {
          // Look for deductions within next 100 lines
          const deductions = [];
          let inDeductionSection = false;
          
          for (let j = i; j < Math.min(i + 100, lines.length); j++) {
            const checkLine = lines[j];
            
            if (checkLine.includes('Fixed Allowance / Deduction')) {
              inDeductionSection = true;
              continue;
            }
            
            if (inDeductionSection && checkLine.trim() && checkLine.match(/^\s*\d+\s+/)) {
              // Parse TXT format deductions
              const parts = checkLine.trim().split(/\s{2,}/);
              
              if (parts.length >= 4) {
                const firstPart = parts[0].trim();
                const match = firstPart.match(/^\d+\s+(\w+)$/);
                
                if (match) {
                  const code = match[1];
                  const description = parts[1] ? parts[1].trim() : '';
                  const amountStr = parts[2] ? parts[2].trim() : '';
                  
                  // Check if negative amount
                  if (amountStr.includes('-')) {
                    const amount = parseAmount(amountStr);
                    
                    let period = null;
                    let startDate = null;
                    let endDate = null;
                    
                    for (let p = 3; p < parts.length; p++) {
                      const part = parts[p].trim();
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
                    
                    if (amount) {
                      deductions.push({
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
          }
          
          if (deductions.length > 0) {
            deductionsMap.set(employeeNo, deductions);
            console.log(`  ✓ ${employeeNo}: ${deductions.length} deduction(s) (from TXT)`);
            deductions.forEach(d => {
              console.log(`    - ${d.description}: RM ${d.amount}`);
            });
            console.log('');
          }
        }
      }
    }
  }
  
  return deductionsMap;
}

// Update database
async function updateDatabase(deductionsMap) {
  console.log(`\n💾 Updating deductions for ${deductionsMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Update in batches
  const entries = Array.from(deductionsMap.entries());
  
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const [employee_no, deductions] of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ deductions: deductions })
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
  console.log('\n🔍 Verifying deductions data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withDeductions } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('deductions', 'is', null);
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With deductions: ${withDeductions} (${((withDeductions/totalCount)*100).toFixed(1)}%)`);
  
  // Get samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, deductions')
    .not('deductions', 'is', null)
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees with deductions:');
    samples.forEach(emp => {
      console.log(`\n  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      if (Array.isArray(emp.deductions)) {
        emp.deductions.forEach(deduction => {
          console.log(`    - ${deduction.description}: RM ${deduction.amount}`);
          console.log(`      Period: ${deduction.start_date || 'N/A'} to ${deduction.end_date || 'N/A'}`);
        });
        const total = emp.deductions.reduce((sum, d) => sum + (d.amount || 0), 0);
        console.log(`    💸 Total deductions: RM ${total.toFixed(2)}`);
      }
    });
  }
  
  // Count deduction types
  const { data: allDeductions } = await supabase
    .from('master_hr2000')
    .select('deductions')
    .not('deductions', 'is', null);
  
  const deductionTypes = {};
  let totalDeductionCount = 0;
  
  allDeductions?.forEach(row => {
    if (Array.isArray(row.deductions)) {
      row.deductions.forEach(deduction => {
        totalDeductionCount++;
        const type = deduction.description || 'Unknown';
        deductionTypes[type] = (deductionTypes[type] || 0) + 1;
      });
    }
  });
  
  console.log(`\n📋 Deduction Type Distribution:`);
  console.log(`  Total deduction entries: ${totalDeductionCount}`);
  Object.entries(deductionTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count} entries`);
    });
}

// Main
async function main() {
  console.log('🔧 THR Fixed Deductions Migration Tool\n');
  console.log('=' .repeat(60));
  console.log('\nThis tool will:');
  console.log('- Extract fixed deductions (ZAKAT, PTPTN, loans, etc.)');
  console.log('- Store them as JSONB array in the deductions column');
  console.log('- Store amounts as positive values\n');
  console.log('=' .repeat(60) + '\n');
  
  // Process files
  const deductionsMap = await processFiles();
  
  if (deductionsMap.size === 0) {
    console.log('\n⚠️  No deductions found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found deductions for ${deductionsMap.size} employees`);
  
  // Update database
  await updateDatabase(deductionsMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}