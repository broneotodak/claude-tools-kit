#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
  console.log('Checking master_hr2000 table structure...\n');
  
  // Get one record to see structure
  const { data, error } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('Columns in master_hr2000:');
    Object.keys(data[0]).forEach(col => {
      console.log(`  - ${col}`);
    });
  } else {
    console.log('No records found. Checking table info...');
    
    // Try a different approach - insert a dummy record to get column info
    const { error: insertError } = await supabase
      .from('master_hr2000')
      .insert({ employee_no: 'TEST' });
    
    if (insertError) {
      console.log('\nColumn info from error message:');
      console.log(insertError.message);
    }
  }
}

checkColumns().catch(console.error);