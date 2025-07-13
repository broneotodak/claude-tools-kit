#!/usr/bin/env node

/**
 * Add allowances JSONB column to master_hr2000 table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function addAllowancesColumn() {
  console.log('🔧 Adding allowances column to master_hr2000 table...\n');
  
  try {
    // Execute SQL to add column
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE master_hr2000 
        ADD COLUMN IF NOT EXISTS allowances JSONB;
      `
    });
    
    if (error) {
      // Try direct query if RPC doesn't exist
      console.log('Trying alternative method...');
      
      // Check if column already exists by trying to select it
      const { error: checkError } = await supabase
        .from('master_hr2000')
        .select('allowances')
        .limit(1);
      
      if (checkError && checkError.message.includes('column "allowances" does not exist')) {
        console.error('❌ Cannot add column directly. Please add it via Supabase dashboard:');
        console.log('\nSQL to execute:');
        console.log('----------------');
        console.log(`ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS allowances JSONB;

COMMENT ON COLUMN master_hr2000.allowances IS 'Individual allowances with details - array of objects containing code, description, amount, period, start_date, end_date';`);
        console.log('----------------\n');
        return false;
      } else if (!checkError) {
        console.log('✅ Column "allowances" already exists!');
        return true;
      }
    }
    
    console.log('✅ Successfully added allowances column!');
    
    // Add comment
    await supabase.rpc('exec_sql', {
      sql: `
        COMMENT ON COLUMN master_hr2000.allowances IS 
        'Individual allowances with details - array of objects containing code, description, amount, period, start_date, end_date';
      `
    });
    
    return true;
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    return false;
  }
}

// Verify column exists
async function verifyColumn() {
  console.log('\n🔍 Verifying column...');
  
  try {
    const { data, error } = await supabase
      .from('master_hr2000')
      .select('allowances')
      .limit(1);
    
    if (error) {
      console.error('❌ Column verification failed:', error.message);
      return false;
    }
    
    console.log('✅ Column "allowances" is accessible!');
    console.log('\n📋 JSONB Structure will be:');
    console.log(`[
  {
    "code": "PHONE",
    "description": "PHONE ALLOWANCE",
    "amount": 70.00,
    "period": "END",
    "start_date": "01/2024",
    "end_date": "12/2024"
  },
  {
    "code": "COVERING",
    "description": "COVERING ALLOWANCE",
    "amount": 500.00,
    "period": "END", 
    "start_date": "02/2023",
    "end_date": "06/2023"
  }
]`);
    
    return true;
  } catch (err) {
    console.error('❌ Error:', err.message);
    return false;
  }
}

// Main
async function main() {
  console.log('🔧 THR Add Allowances Column Tool\n');
  console.log('=' .repeat(60));
  
  const added = await addAllowancesColumn();
  
  if (added) {
    await verifyColumn();
    console.log('\n✅ Ready to migrate allowances data!');
  } else {
    console.log('\n⚠️  Please add the column manually in Supabase dashboard.');
  }
}

if (require.main === module) {
  main().catch(console.error);
}