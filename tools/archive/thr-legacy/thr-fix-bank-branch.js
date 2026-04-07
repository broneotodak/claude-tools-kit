#!/usr/bin/env node

/**
 * Fix bank_branch in master_hr2000 table
 * Converts bank codes to JSONB format with full bank details
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Bank code mappings
const BANK_MAPPINGS = {
  'MBB': { code: 'MBB', name: 'Maybank', type: 'bank' },
  'CIBB': { code: 'CIBB', name: 'CIMB Bank', type: 'bank' },
  '/': { code: null, name: null, type: 'cash' }
};

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const bankBranchMap = new Map();
  
  // Process CSV files first
  console.log('📊 Processing CSV files for bank branch data...\n');
  
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  let totalEmployees = 0;
  
  for (const file of csvFiles) {
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let currentEmployee = null;
    let pendingBankBranch = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for bank branch line
      if (line.startsWith('Bank Code/ Branch')) {
        const parts = line.split(',');
        if (parts[3]) {
          const bankCode = parts[3].trim();
          const normalizedCode = bankCode.replace(/\\/g, '/'); // Handle escaped slashes
          for (const [code, info] of Object.entries(BANK_MAPPINGS)) {
            if (normalizedCode === code || normalizedCode.includes(code)) {
              pendingBankBranch = info;
              break;
            }
          }
        }
      }
      
      // When we hit Employee No., assign pending bank branch to this employee
      if (line.startsWith('Employee No.')) {
        const parts = line.split(',');
        if (parts[3]) {
          currentEmployee = parts[3].trim();
          
          if (currentEmployee && pendingBankBranch) {
            bankBranchMap.set(currentEmployee, pendingBankBranch);
            console.log(`  ✓ ${currentEmployee}: ${pendingBankBranch.type === 'bank' ? pendingBankBranch.name : 'Cash payment'}`);
            totalEmployees++;
            
            // Reset for next employee
            pendingBankBranch = null;
          }
        }
      }
    }
  }
  
  // Process TXT files for any missing data
  console.log('\n📊 Processing TXT files for additional bank branch data...\n');
  
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
          // Look ahead for employee number
          for (let k = i + 1; k < Math.min(i + 5, lines.length); k++) {
            const nextLine = lines[k].trim();
            if (nextLine && nextLine.match(/^[A-Z]+\\d+$/)) {
              employeeNo = nextLine;
              break;
            }
          }
        }
        
        // Only process if we don't already have this employee
        if (employeeNo && !bankBranchMap.has(employeeNo)) {
          // Look for bank branch within next 50 lines
          for (let j = i; j < Math.min(i + 50, lines.length); j++) {
            const checkLine = lines[j];
            if (checkLine.includes('Bank Code/ Branch')) {
              const match = checkLine.match(/Bank Code\/\s*Branch\s+([A-Z]+\/|\/)/);
              if (match) {
                const bankCode = match[1].trim();
                const bankInfo = Object.entries(BANK_MAPPINGS).find(([code]) => bankCode === code);
                if (bankInfo) {
                  bankBranchMap.set(employeeNo, bankInfo[1]);
                  console.log(`  ✓ ${employeeNo}: ${bankInfo[1].type === 'bank' ? bankInfo[1].name : 'Cash payment'} (from TXT)`);
                  totalEmployees++;
                }
              }
              break;
            }
          }
        }
      }
    }
  }
  
  console.log(`\n📋 Found bank branch data for ${totalEmployees} employees`);
  return bankBranchMap;
}

// Update database
async function updateDatabase(bankBranchMap) {
  console.log(`\n💾 Updating bank branch data for ${bankBranchMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Update in batches
  const entries = Array.from(bankBranchMap.entries());
  
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const [employee_no, bank_branch] of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ bank_branch: bank_branch })
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
  console.log('\n🔍 Verifying bank branch data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withBankBranch } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('bank_branch', 'is', null);
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With bank branch: ${withBankBranch} (${((withBankBranch/totalCount)*100).toFixed(1)}%)`);
  
  // Get samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, bank_branch')
    .not('bank_branch', 'is', null)
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees with bank branch:');
    samples.forEach(emp => {
      console.log(`\n  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      const bank = emp.bank_branch;
      if (bank) {
        if (bank.type === 'bank') {
          console.log(`    Bank: ${bank.name} (${bank.code})`);
        } else {
          console.log(`    Payment: Cash`);
        }
      }
    });
  }
  
  // Count payment types
  const { data: allBankBranch } = await supabase
    .from('master_hr2000')
    .select('bank_branch')
    .not('bank_branch', 'is', null);
  
  const paymentTypes = {
    bank: 0,
    cash: 0
  };
  
  const bankCounts = {};
  
  allBankBranch?.forEach(row => {
    const bank = row.bank_branch;
    if (bank) {
      paymentTypes[bank.type]++;
      if (bank.type === 'bank') {
        bankCounts[bank.name] = (bankCounts[bank.name] || 0) + 1;
      }
    }
  });
  
  console.log('\n📋 Payment Type Distribution:');
  console.log(`  Bank payments: ${paymentTypes.bank} employees`);
  console.log(`  Cash payments: ${paymentTypes.cash} employees`);
  
  if (Object.keys(bankCounts).length > 0) {
    console.log('\n📋 Bank Distribution:');
    Object.entries(bankCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([bank, count]) => {
        console.log(`  ${bank}: ${count} employees`);
      });
  }
}

// Main
async function main() {
  console.log('🔧 THR Bank Branch Migration Tool\n');
  console.log('='.repeat(60));
  console.log('\nThis tool will:');
  console.log('- Convert bank codes to structured JSONB format');
  console.log('- Store full bank details and payment type\n');
  console.log('='.repeat(60) + '\n');
  
  // Process files
  const bankBranchMap = await processFiles();
  
  if (bankBranchMap.size === 0) {
    console.log('\n⚠️  No bank branch data found in raw data.');
    return;
  }
  
  // Update database
  await updateDatabase(bankBranchMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}