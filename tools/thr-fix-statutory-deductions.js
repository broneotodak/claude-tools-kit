#!/usr/bin/env node

/**
 * Fix statutory_deductions in master_hr2000 table
 * Extracts EPF, SOCSO, EIS, PCB group assignments
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Extract statutory deduction groups from CSV
function extractStatutoryFromCSV(lines, startIdx) {
  const statutory = {
    epf_group: null,
    socso_group: null,
    eis_group: null,
    pcb_group: null,
    deduct_levy: null
  };
  
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    
    // EPF Group - value is in column 13
    if (line.includes('EPF Group')) {
      const parts = line.split(',');
      if (parts[13] && parts[13].trim() && parts[13].trim() !== 'EPF Group') {
        statutory.epf_group = parts[13].trim();
      }
    }
    
    // SOCSO Group - value is in column 13
    if (line.includes('SOCSO Group')) {
      const parts = line.split(',');
      if (parts[13] && parts[13].trim() && parts[13].trim() !== 'SOCSO Group') {
        statutory.socso_group = parts[13].trim();
      }
    }
    
    // EIS - value is in column 13
    if (line.includes('EIS') && !line.includes('EPF')) {
      const parts = line.split(',');
      if (parts[13] && parts[13].trim() && parts[13].trim() !== 'EIS') {
        statutory.eis_group = parts[13].trim();
      }
    }
    
    // PCB/Tax Group - value is in column 13
    if (line.includes('PCB/Tax Group')) {
      const parts = line.split(',');
      if (parts[13] && parts[13].trim() && parts[13].trim() !== 'PCB/Tax Group') {
        statutory.pcb_group = parts[13].trim();
      }
    }
    
    // Deduct Levy - value is in column 13
    if (line.includes('Deduct Levy')) {
      const parts = line.split(',');
      if (parts[13] && parts[13].trim()) {
        statutory.deduct_levy = parts[13].trim().toUpperCase() === 'YES';
      }
    }
  }
  
  return statutory;
}

// Extract statutory deduction groups from TXT
function extractStatutoryFromTXT(lines, startIdx) {
  const statutory = {
    epf_group: null,
    socso_group: null,
    eis_group: null,
    pcb_group: null,
    deduct_levy: null
  };
  
  for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
    const line = lines[i];
    
    // EPF Group
    if (line.includes('EPF Group') && !line.includes('EPF Nk')) {
      const match = line.match(/EPF Group\s+(.+?)(?:\s{2,}|$)/);
      if (match && match[1].trim() !== 'EPF Group') {
        statutory.epf_group = match[1].trim();
      }
    }
    
    // SOCSO Group
    if (line.includes('SOCSO Group')) {
      const match = line.match(/SOCSO Group\s+(.+?)(?:\s{2,}|$)/);
      if (match && match[1].trim() !== 'SOCSO Group') {
        statutory.socso_group = match[1].trim();
      }
    }
    
    // EIS
    if (line.match(/\bEIS\b/) && !line.includes('EPF')) {
      const match = line.match(/EIS\s+(.+?)(?:\s{2,}|$)/);
      if (match && match[1].trim() !== 'EIS') {
        statutory.eis_group = match[1].trim();
      }
    }
    
    // PCB/Tax Group
    if (line.includes('PCB/Tax Group')) {
      const match = line.match(/PCB\/Tax Group\s+(.+?)(?:\s{2,}|$)/);
      if (match && match[1].trim() !== 'PCB/Tax Group') {
        statutory.pcb_group = match[1].trim();
      }
    }
    
    // Deduct Levy
    if (line.includes('Deduct Levy')) {
      const match = line.match(/Deduct Levy\s+(YES|NO|Yes|No)/i);
      if (match) {
        statutory.deduct_levy = match[1].toUpperCase() === 'YES';
      }
    }
  }
  
  return statutory;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const statutoryMap = new Map();
  
  // Process CSV files
  console.log('📊 Processing CSV files for statutory deduction groups...\n');
  
  const csvFiles = files.filter(f => f.endsWith('.csv')).sort();
  let totalEmployees = 0;
  
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
          totalEmployees++;
        }
      }
      
      // After finding employee number, look ahead for statutory groups
      if (line.startsWith('Employee No.') && currentEmployee) {
        const statutory = extractStatutoryFromCSV(lines, i); // Look forward from current position
        
        // Only add if we found at least one group
        if (statutory.epf_group || statutory.socso_group || statutory.eis_group || statutory.pcb_group) {
          statutoryMap.set(currentEmployee, statutory);
          console.log(`  ✓ ${currentEmployee}:`);
          if (statutory.epf_group) console.log(`    EPF: ${statutory.epf_group}`);
          if (statutory.socso_group) console.log(`    SOCSO: ${statutory.socso_group}`);
          if (statutory.eis_group) console.log(`    EIS: ${statutory.eis_group}`);
          if (statutory.pcb_group) console.log(`    PCB: ${statutory.pcb_group}`);
          if (statutory.deduct_levy !== null) console.log(`    Levy: ${statutory.deduct_levy ? 'Yes' : 'No'}`);
          console.log('');
        }
      }
    }
  }
  
  console.log(`Processed ${totalEmployees} employees from CSV files`);
  
  // Process TXT files for missing data
  console.log('\n📊 Processing TXT files for additional statutory groups...\n');
  
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
        
        if (employeeNo && !statutoryMap.has(employeeNo)) {
          const statutory = extractStatutoryFromTXT(lines, i);
          
          if (statutory.epf_group || statutory.socso_group || statutory.eis_group || statutory.pcb_group) {
            statutoryMap.set(employeeNo, statutory);
            console.log(`  ✓ ${employeeNo} (from TXT):`);
            if (statutory.epf_group) console.log(`    EPF: ${statutory.epf_group}`);
            if (statutory.socso_group) console.log(`    SOCSO: ${statutory.socso_group}`);
            if (statutory.eis_group) console.log(`    EIS: ${statutory.eis_group}`);
            if (statutory.pcb_group) console.log(`    PCB: ${statutory.pcb_group}`);
            if (statutory.deduct_levy !== null) console.log(`    Levy: ${statutory.deduct_levy ? 'Yes' : 'No'}`);
            console.log('');
          }
        }
      }
    }
  }
  
  return statutoryMap;
}

// Update database
async function updateDatabase(statutoryMap) {
  console.log(`\n💾 Updating statutory deductions for ${statutoryMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Update in batches
  const entries = Array.from(statutoryMap.entries());
  
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const [employee_no, statutory] of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({ statutory_deductions: statutory })
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
  
  console.log(`\n✅ Successfully updated: ${updated} records`);
  if (errors > 0) {
    console.log(`❌ Errors: ${errors} records`);
  }
  
  return updated;
}

// Verify update
async function verifyUpdate() {
  console.log('\n🔍 Verifying statutory deductions data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withStatutory } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('statutory_deductions', 'is', null);
  
  console.log(`📊 Statistics:`);
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With statutory groups: ${withStatutory} (${((withStatutory/totalCount)*100).toFixed(1)}%)`);
  
  // Get samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, statutory_deductions')
    .not('statutory_deductions', 'is', null)
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample employees with statutory groups:');
    samples.forEach(emp => {
      console.log(`\n  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      const stat = emp.statutory_deductions;
      if (stat) {
        if (stat.epf_group) console.log(`    EPF: ${stat.epf_group}`);
        if (stat.socso_group) console.log(`    SOCSO: ${stat.socso_group}`);
        if (stat.eis_group) console.log(`    EIS: ${stat.eis_group}`);
        if (stat.pcb_group) console.log(`    PCB: ${stat.pcb_group}`);
        if (stat.deduct_levy !== null) console.log(`    Levy: ${stat.deduct_levy ? 'Yes' : 'No'}`);
      }
    });
  }
  
  // Get distribution of groups
  const { data: allStatutory } = await supabase
    .from('master_hr2000')
    .select('statutory_deductions')
    .not('statutory_deductions', 'is', null);
  
  const epfGroups = {};
  const socsoGroups = {};
  const pcbGroups = {};
  
  allStatutory?.forEach(row => {
    const stat = row.statutory_deductions;
    if (stat) {
      if (stat.epf_group) epfGroups[stat.epf_group] = (epfGroups[stat.epf_group] || 0) + 1;
      if (stat.socso_group) socsoGroups[stat.socso_group] = (socsoGroups[stat.socso_group] || 0) + 1;
      if (stat.pcb_group) pcbGroups[stat.pcb_group] = (pcbGroups[stat.pcb_group] || 0) + 1;
    }
  });
  
  console.log('\n📋 EPF Group Distribution:');
  Object.entries(epfGroups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([group, count]) => {
      console.log(`  ${group}: ${count} employees`);
    });
  
  console.log('\n📋 SOCSO Group Distribution:');
  Object.entries(socsoGroups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([group, count]) => {
      console.log(`  ${group}: ${count} employees`);
    });
  
  console.log('\n📋 PCB/Tax Group Distribution:');
  Object.entries(pcbGroups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([group, count]) => {
      console.log(`  ${group}: ${count} employees`);
    });
}

// Main
async function main() {
  console.log('🔧 THR Statutory Deductions Migration Tool\n');
  console.log('=' .repeat(60));
  console.log('\nThis tool will:');
  console.log('- Extract EPF, SOCSO, EIS, PCB group assignments');
  console.log('- Store them as JSONB in statutory_deductions column\n');
  console.log('=' .repeat(60) + '\n');
  
  // Process files
  const statutoryMap = await processFiles();
  
  if (statutoryMap.size === 0) {
    console.log('\n⚠️  No statutory deduction groups found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found statutory groups for ${statutoryMap.size} employees`);
  
  // Update database
  await updateDatabase(statutoryMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}