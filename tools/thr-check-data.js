#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkData() {
  console.log('🔍 Checking imported data in master_hr2000...\n');
  
  // Get sample records to see what was imported
  const { data: samples, error } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(5);
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  if (samples && samples.length > 0) {
    console.log('Sample records:\n');
    samples.forEach((record, idx) => {
      console.log(`Record ${idx + 1}:`);
      Object.entries(record).forEach(([key, value]) => {
        if (value !== null && value !== '') {
          console.log(`  ${key}: ${JSON.stringify(value).substring(0, 100)}`);
        }
      });
      console.log('-'.repeat(60));
    });
    
    // Check all columns
    console.log('\nAll columns in the table:');
    Object.keys(samples[0]).forEach(col => {
      console.log(`  - ${col}`);
    });
  }
  
  // Check if we have any name data
  console.log('\n\nChecking for potential name columns...');
  const possibleNameColumns = Object.keys(samples[0]).filter(col => 
    col.toLowerCase().includes('name') || 
    col.toLowerCase().includes('nama')
  );
  
  if (possibleNameColumns.length > 0) {
    console.log('Found these name-related columns:', possibleNameColumns);
  } else {
    console.log('No name-related columns found in the table!');
  }
}

checkData().catch(console.error);