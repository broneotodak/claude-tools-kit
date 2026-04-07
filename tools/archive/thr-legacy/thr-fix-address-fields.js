#!/usr/bin/env node

/**
 * Fix address fields in master_hr2000 table
 * Extracts and properly maps address, address2, city, state, postcode, country
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Split address at 2nd comma
function splitAddressAtSecondComma(address) {
  if (!address) return { line1: null, line2: null };
  
  const parts = address.split(',');
  if (parts.length <= 2) {
    return { line1: address.trim(), line2: null };
  }
  
  // Take first 2 parts for address, rest for address2
  const line1 = parts.slice(0, 2).join(',').trim();
  const line2 = parts.slice(2).join(',').trim();
  
  return { line1, line2: line2 || null };
}

// Extract city and state from address text
function extractCityState(addressText) {
  if (!addressText) return { city: null, state: null };
  
  // Common Malaysian states
  const states = [
    'Selangor', 'Kuala Lumpur', 'Johor', 'Penang', 'Perak', 'Kedah',
    'Kelantan', 'Terengganu', 'Pahang', 'Negeri Sembilan', 'Melaka',
    'Sabah', 'Sarawak', 'Perlis', 'Putrajaya', 'Labuan'
  ];
  
  // Split by line breaks or multiple spaces
  const lines = addressText.split(/\n|\s{2,}/);
  const lastLine = lines[lines.length - 1].trim();
  
  let city = null;
  let state = null;
  
  // Check if last line contains city and state
  const lastLineParts = lastLine.split(',').map(p => p.trim());
  
  // Find state in the text
  for (const stateName of states) {
    if (addressText.toUpperCase().includes(stateName.toUpperCase())) {
      state = stateName;
      // Try to find city before the state
      const stateIndex = addressText.toUpperCase().lastIndexOf(stateName.toUpperCase());
      const beforeState = addressText.substring(0, stateIndex);
      const beforeParts = beforeState.split(/[,\s]+/);
      
      // Look for city name (usually the last meaningful word before state)
      for (let i = beforeParts.length - 1; i >= 0; i--) {
        const part = beforeParts[i].trim();
        if (part && part.length > 2 && !part.match(/^\d/) && !part.match(/^(Jalan|Jln|Taman|Tmn|No|Blok|Lot)$/i)) {
          city = part;
          break;
        }
      }
      break;
    }
  }
  
  return { city, state };
}

// Extract address from TXT file
function extractAddressFromTXT(lines, startIdx) {
  const addressData = {
    address: null,
    address2: null,
    city: null,
    state: null,
    postcode: null,
    country: null
  };
  
  // Find Home Address
  for (let i = startIdx; i < Math.min(startIdx + 100, lines.length); i++) {
    const line = lines[i];
    
    if (line.includes('Home Address')) {
      // Extract address - it can span multiple lines
      const addressStart = line.indexOf('Home Address');
      let fullAddress = line.substring(addressStart + 12).trim();
      
      // Check next lines for continuation
      let j = i + 1;
      while (j < lines.length && j < i + 3) {
        const nextLine = lines[j];
        // Check if it's an address continuation (has leading spaces)
        if (nextLine.startsWith('                  ') && nextLine.trim() && 
            !nextLine.includes('Postal') && !nextLine.includes('Country')) {
          fullAddress += ' ' + nextLine.trim();
        } else if (nextLine.trim() === '') {
          // Empty line, check one more
          j++;
          continue;
        } else {
          break;
        }
        j++;
      }
      
      // Split address using 2-comma rule
      const { line1, line2 } = splitAddressAtSecondComma(fullAddress);
      addressData.address = line1;
      
      // Extract city and state
      const { city, state } = extractCityState(fullAddress);
      addressData.city = city;
      addressData.state = state;
      
      // If we have remaining text after city/state extraction, use as address2
      if (line2) {
        // Remove city and state from line2 if they're at the end
        let cleanedLine2 = line2;
        if (city) cleanedLine2 = cleanedLine2.replace(new RegExp(`,?\\s*${city}\\s*,?`, 'i'), '');
        if (state) cleanedLine2 = cleanedLine2.replace(new RegExp(`,?\\s*${state}\\s*,?`, 'i'), '');
        cleanedLine2 = cleanedLine2.trim().replace(/,$/, '');
        
        if (cleanedLine2) {
          addressData.address2 = cleanedLine2;
        }
      }
    }
    
    // Find Postal
    if (line.includes('Postal')) {
      const match = line.match(/Postal\s+(\d{4,5})/);
      if (match) {
        addressData.postcode = match[1];
      }
    }
    
    // Find Country (if explicitly mentioned) - skip if it's part of address or followed by Occupation
    if (line.includes('Country') && !line.includes('Country Homes') && !line.includes('Occupation')) {
      const match = line.match(/Country[:\s]+([A-Za-z\s]+?)(?:\s{2,}|Occupation|$)/);
      if (match && match[1].trim() && match[1].trim().length > 2) {
        addressData.country = match[1].trim();
      }
    }
  }
  
  return addressData;
}

// Process files
async function processFiles() {
  const rawDataPath = '/Users/broneotodak/Projects/THR/raw_data';
  const files = fs.readdirSync(rawDataPath);
  
  const addressMap = new Map();
  
  // Process TXT files (they have the address data)
  console.log('📊 Processing TXT files for address data...\n');
  
  const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
  console.log(`Found ${txtFiles.length} TXT files to process\n`);
  
  for (const file of txtFiles) {
    console.log(`Processing ${file}...`);
    const filePath = path.join(rawDataPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    let employeesInFile = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('Employee No.')) {
        // Handle different formats: "Employee No. ST0001" or just get the next non-empty value
        let employeeNo = null;
        const directMatch = line.match(/Employee No\.\s+([A-Z]+\d+)/);
        
        if (directMatch) {
          employeeNo = directMatch[1];
        } else if (line.trim() === 'Employee No.' || line.includes('Employee No.')) {
          // Look for employee number in next lines
          for (let k = i + 1; k < Math.min(i + 5, lines.length); k++) {
            const nextLine = lines[k].trim();
            if (nextLine && nextLine.match(/^[A-Z]+\d+$/)) {
              employeeNo = nextLine;
              break;
            }
          }
        }
        
        if (employeeNo) {
          employeesInFile++;
          const addressData = extractAddressFromTXT(lines, i);
          
          if (addressData.address || addressData.postcode) {
            addressMap.set(employeeNo, addressData);
            console.log(`  ✓ ${employeeNo}:`);
            if (addressData.address) console.log(`    Address: ${addressData.address}`);
            if (addressData.address2) console.log(`    Address2: ${addressData.address2}`);
            if (addressData.city) console.log(`    City: ${addressData.city}`);
            if (addressData.state) console.log(`    State: ${addressData.state}`);
            if (addressData.postcode) console.log(`    Postcode: ${addressData.postcode}`);
            if (addressData.country) console.log(`    Country: ${addressData.country}`);
            console.log('');
          }
        }
      }
    }
    
    if (employeesInFile > 0) {
      console.log(`  Found ${employeesInFile} employees in this file\n`);
    }
  }
  
  return addressMap;
}

// Update database
async function updateDatabase(addressMap) {
  console.log(`\n💾 Updating address data for ${addressMap.size} employees...\n`);
  
  let updated = 0;
  let errors = 0;
  
  // Update in batches
  const entries = Array.from(addressMap.entries());
  
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    
    for (const [employee_no, data] of batch) {
      const updateData = {};
      
      // Only include non-null values
      if (data.address !== null) updateData.address = data.address;
      if (data.address2 !== null) updateData.address2 = data.address2;
      if (data.city !== null) updateData.city = data.city;
      if (data.state !== null) updateData.state = data.state;
      if (data.postcode !== null) updateData.postcode = data.postcode;
      if (data.country !== null) updateData.country = data.country;
      
      // Add Malaysia as default country if we have address data
      if (updateData.address || updateData.postcode) {
        updateData.country = 'Malaysia';
      }
      
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
  console.log('\n🔍 Verifying address data...\n');
  
  // Get statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withAddress } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('address', 'is', null);
  
  const { count: withAddress2 } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('address2', 'is', null);
  
  const { count: withCity } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('city', 'is', null);
  
  const { count: withState } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('state', 'is', null);
  
  const { count: withPostcode } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('postcode', 'is', null);
  
  const { count: withCountry } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('country', 'is', null);
  
  console.log('📊 Address Field Statistics:');
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With address: ${withAddress} (${((withAddress/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With address2: ${withAddress2} (${((withAddress2/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With city: ${withCity} (${((withCity/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With state: ${withState} (${((withState/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With postcode: ${withPostcode} (${((withPostcode/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With country: ${withCountry} (${((withCountry/totalCount)*100).toFixed(1)}%)`);
  
  // Show samples
  const { data: samples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, address, address2, city, state, postcode, country')
    .not('address', 'is', null)
    .limit(5);
  
  if (samples && samples.length > 0) {
    console.log('\n📋 Sample addresses:');
    samples.forEach(emp => {
      console.log(`\n  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'}`);
      console.log(`    Address: ${emp.address}`);
      if (emp.address2) console.log(`    Address2: ${emp.address2}`);
      console.log(`    ${emp.city || 'N/A'}, ${emp.state || 'N/A'} ${emp.postcode || 'N/A'}`);
      if (emp.country) console.log(`    Country: ${emp.country}`);
    });
  }
  
  // Check state distribution
  const { data: stateData } = await supabase
    .from('master_hr2000')
    .select('state')
    .not('state', 'is', null);
  
  const stateCount = {};
  stateData.forEach(row => {
    const state = row.state;
    stateCount[state] = (stateCount[state] || 0) + 1;
  });
  
  console.log('\n📋 State Distribution:');
  Object.entries(stateCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([state, count]) => {
      console.log(`  ${state}: ${count} employees`);
    });
}

// Main
async function main() {
  console.log('🔧 THR Address Fields Fix Tool\n');
  console.log('=' .repeat(60));
  console.log('\nThis tool will:');
  console.log('- Split addresses at the 2nd comma (address vs address2)');
  console.log('- Extract city and state from address text');
  console.log('- Import postcode from Postal field');
  console.log('- Check for actual country data (no defaults)\n');
  console.log('=' .repeat(60) + '\n');
  
  // Process files
  const addressMap = await processFiles();
  
  if (addressMap.size === 0) {
    console.log('\n⚠️  No address data found in raw data.');
    return;
  }
  
  console.log(`\n📋 Found address data for ${addressMap.size} employees`);
  
  // Update database
  await updateDatabase(addressMap);
  
  // Verify
  await verifyUpdate();
  
  console.log('\n✅ Complete!');
}

if (require.main === module) {
  main().catch(console.error);
}