#!/usr/bin/env node

/**
 * Inspect master_hr2000 table schema
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function inspectSchema() {
  console.log('🔍 Inspecting master_hr2000 table schema...\n');
  
  // Query information schema to get column details
  const { data: columns, error } = await supabase.rpc('get_table_schema', {
    table_name: 'master_hr2000'
  });
  
  if (error) {
    console.log('RPC function not available. Trying alternative method...\n');
    
    // Try to get schema via a failed insert with all possible fields
    const testRecord = {
      id: '00000000-0000-0000-0000-000000000000',
      employee_no: 'TEST',
      name: 'TEST',
      organization_id: '00000000-0000-0000-0000-000000000000',
      organization_code: 'TEST',
      ic_no: 'TEST',
      email: 'test@test.com',
      mobile_no: '0123456789',
      department: 'TEST',
      designation: 'TEST',
      hire_date: '2024-01-01',
      current_basic: 1000,
      bank_account_no: '1234567890',
      epf_no: 'TEST',
      socso_no: 'TEST',
      income_tax_no: 'TEST',
      // Add many more fields to discover what exists
      passport_no: 'TEST',
      nationality: 'TEST',
      race: 'TEST',
      religion: 'TEST',
      gender: 'M',
      marital_status: 'S',
      birth_date: '1990-01-01',
      children_count: 0,
      home_phone: 'TEST',
      address: 'TEST',
      resign_date: null,
      confirm_date: null,
      payment_type: 'TEST',
      payment_frequency: 'TEST',
      bank_code: 'TEST',
      csv_data: {},
      txt_data: {},
      data_source: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { error: insertError } = await supabase
      .from('master_hr2000')
      .insert(testRecord);
    
    if (insertError) {
      console.log('Error details:', insertError.message);
      console.log('\nThis error reveals information about the table structure.');
      
      // Extract column info from error
      if (insertError.message.includes('Could not find')) {
        const match = insertError.message.match(/Could not find the '(.+?)' column/);
        if (match) {
          console.log(`\n❌ Column '${match[1]}' does not exist in the table`);
        }
      }
    }
  } else if (columns) {
    console.log('Table columns:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type})`);
    });
  }
  
  // Try to get existing organizations for foreign key reference
  console.log('\n📋 Checking available organizations...');
  const { data: orgs, error: orgError } = await supabase
    .from('thr_organizations')
    .select('id, name, code')
    .order('code');
  
  if (orgs) {
    console.log('\nAvailable organizations:');
    orgs.forEach(org => {
      console.log(`  ${org.code}: ${org.name} (${org.id})`);
    });
  }
}

inspectSchema().catch(console.error);