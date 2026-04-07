#!/usr/bin/env node

/**
 * Discover master_hr2000 table schema by testing fields
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function testField(fieldName, value) {
  const testRecord = {
    employee_no: 'SCHEMA_TEST_' + Date.now(),
    organization_id: '01b1dd76-e88b-4767-843a-e7bb96bbeca0', // 10Camp
    [fieldName]: value
  };
  
  const { error } = await supabase
    .from('master_hr2000')
    .insert(testRecord);
  
  if (error) {
    if (error.message.includes(`Could not find the '${fieldName}' column`)) {
      return { field: fieldName, exists: false, error: 'Column not found' };
    }
    return { field: fieldName, exists: true, error: error.message };
  }
  
  // Clean up successful insert
  await supabase
    .from('master_hr2000')
    .delete()
    .eq('employee_no', testRecord.employee_no);
  
  return { field: fieldName, exists: true, error: null };
}

async function discoverSchema() {
  console.log('🔍 Discovering master_hr2000 table schema...\n');
  
  // List of potential fields to test
  const fieldsToTest = [
    // Basic fields
    { name: 'name', value: 'Test Name' },
    { name: 'full_name', value: 'Test Full Name' },
    { name: 'organization_code', value: '10C' },
    
    // Personal fields
    { name: 'ic_no', value: '123456789012' },
    { name: 'ic_new', value: '123456789012' },
    { name: 'ic_number', value: '123456789012' },
    { name: 'old_ic_no', value: '1234567' },
    { name: 'passport_no', value: 'A1234567' },
    { name: 'nationality', value: 'Malaysian' },
    { name: 'race', value: 'Malay' },
    { name: 'religion', value: 'Islam' },
    { name: 'gender', value: 'M' },
    { name: 'marital_status', value: 'Single' },
    { name: 'birth_date', value: '1990-01-01' },
    { name: 'children_count', value: 0 },
    
    // Contact fields
    { name: 'email', value: 'test@example.com' },
    { name: 'mobile_no', value: '0123456789' },
    { name: 'mobile', value: '0123456789' },
    { name: 'phone', value: '0123456789' },
    { name: 'home_phone', value: '0123456789' },
    { name: 'address', value: 'Test Address' },
    
    // Employment fields
    { name: 'department', value: 'IT' },
    { name: 'designation', value: 'Developer' },
    { name: 'position', value: 'Developer' },
    { name: 'hire_date', value: '2024-01-01' },
    { name: 'join_date', value: '2024-01-01' },
    { name: 'resign_date', value: null },
    { name: 'confirm_date', value: '2024-03-01' },
    
    // Financial fields
    { name: 'current_basic', value: 5000 },
    { name: 'basic_salary', value: 5000 },
    { name: 'salary', value: 5000 },
    { name: 'payment_type', value: 'Bank' },
    { name: 'payment_frequency', value: 'Monthly' },
    { name: 'bank_code', value: 'MBB' },
    { name: 'bank_account', value: '1234567890' },
    { name: 'bank_account_no', value: '1234567890' },
    { name: 'bank_account_number', value: '1234567890' },
    
    // Statutory fields
    { name: 'epf_no', value: 'EPF123456' },
    { name: 'epf_number', value: 'EPF123456' },
    { name: 'socso_no', value: 'S1234567' },
    { name: 'socso_number', value: 'S1234567' },
    { name: 'income_tax_no', value: 'SG12345678' },
    { name: 'tax_number', value: 'SG12345678' },
    
    // Metadata fields
    { name: 'csv_data', value: {} },
    { name: 'txt_data', value: {} },
    { name: 'raw_data', value: {} },
    { name: 'import_data', value: {} },
    { name: 'data_source', value: 'test' },
    { name: 'created_at', value: new Date().toISOString() },
    { name: 'updated_at', value: new Date().toISOString() },
    { name: 'last_updated', value: new Date().toISOString() }
  ];
  
  console.log(`Testing ${fieldsToTest.length} potential fields...\n`);
  
  const existingFields = [];
  const missingFields = [];
  
  for (const field of fieldsToTest) {
    const result = await testField(field.name, field.value);
    
    if (result.exists) {
      existingFields.push(field.name);
      process.stdout.write('✓');
    } else {
      missingFields.push(field.name);
      process.stdout.write('✗');
    }
  }
  
  console.log('\n\n📊 Results:\n');
  
  console.log(`✅ Existing fields (${existingFields.length}):`);
  existingFields.forEach(field => console.log(`  - ${field}`));
  
  console.log(`\n❌ Missing fields (${missingFields.length}):`);
  missingFields.forEach(field => console.log(`  - ${field}`));
  
  // Test minimal required fields
  console.log('\n🧪 Testing minimal insert...');
  const minimalRecord = {
    employee_no: 'MIN_TEST_' + Date.now(),
    organization_id: '01b1dd76-e88b-4767-843a-e7bb96bbeca0'
  };
  
  const { error: minError } = await supabase
    .from('master_hr2000')
    .insert(minimalRecord);
  
  if (minError) {
    console.log('❌ Minimal insert failed:', minError.message);
  } else {
    console.log('✅ Minimal insert successful!');
    console.log('Required fields: employee_no, organization_id');
    
    // Clean up
    await supabase
      .from('master_hr2000')
      .delete()
      .eq('employee_no', minimalRecord.employee_no);
  }
}

discoverSchema().catch(console.error);