#!/usr/bin/env node

/**
 * THR Test Import - Discover table structure and import
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function testImport() {
  console.log('🧪 THR Test Import - Discovering table structure\n');
  
  // Try a minimal insert to see what columns are required
  console.log('Testing minimal insert...');
  
  const testRecord = {
    employee_no: 'TEST001',
    organization_id: '01b1dd76-e88b-4767-843a-e7bb96bbeca0' // 10Camp
  };
  
  const { error: testError } = await supabase
    .from('master_hr2000')
    .insert(testRecord);
  
  if (testError) {
    console.log('Error with minimal record:', testError.message);
    console.log('\nThis tells us what columns might be missing or required.\n');
  }
  
  // Load our data
  const dataFile = '/Users/broneotodak/Projects/claude-tools-kit/thr-import-data.json';
  const allEmployees = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  
  console.log(`\nLoaded ${allEmployees.length} employees from merged data\n`);
  
  // Try different field combinations
  const employee = allEmployees[0];
  
  console.log('Attempting import with different field sets...\n');
  
  // Test 1: Most basic fields
  const test1 = {
    employee_no: employee.employee_no,
    name: employee.name,
    organization_id: employee.organization_id,
    ic_no: employee.ic_no,
    email: employee.email?.replace(/\|$/, '').trim()
  };
  
  console.log('Test 1 - Basic fields:', Object.keys(test1).join(', '));
  const { data: data1, error: error1 } = await supabase
    .from('master_hr2000')
    .insert(test1)
    .select();
  
  if (error1) {
    console.log('❌ Failed:', error1.message);
  } else {
    console.log('✅ Success! Imported:', data1[0].employee_no);
    console.log('\nSuccessful record structure:');
    console.log(JSON.stringify(data1[0], null, 2));
    
    // Clean up test record
    await supabase
      .from('master_hr2000')
      .delete()
      .eq('employee_no', test1.employee_no);
  }
  
  // If first test failed, try even more minimal
  if (error1) {
    console.log('\nTest 2 - Ultra minimal:');
    const test2 = {
      employee_no: 'TEST002',
      organization_id: employee.organization_id
    };
    
    const { error: error2 } = await supabase
      .from('master_hr2000')
      .insert(test2);
    
    if (error2) {
      console.log('❌ Failed:', error2.message);
      
      // Try to understand the constraint
      if (error2.message.includes('violates foreign key constraint')) {
        console.log('\n⚠️  Organization ID might not exist in thr_organizations table');
        console.log('Organization ID used:', employee.organization_id);
      }
    }
  }
  
  // Show sample of our data
  console.log('\n📋 Sample of data we want to import:');
  console.log(JSON.stringify(allEmployees[0], null, 2));
}

testImport().catch(console.error);