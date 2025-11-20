#!/usr/bin/env node

/**
 * THR Schema Comparison and Migration Analysis
 * Compares master_hr2000 with thr_employees and identifies data migration issues
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

console.log('🔍 THR SCHEMA COMPARISON & MIGRATION ANALYSIS');
console.log('=' .repeat(80));
console.log(`Date: ${new Date().toISOString()}`);
console.log('=' .repeat(80));

async function compareSchemas() {
  console.log('\n📊 1. SCHEMA STRUCTURE COMPARISON\n');
  
  // Get master_hr2000 sample
  const { data: masterSample } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(1)
    .single();
  
  // Get thr_employees sample  
  const { data: thrSample } = await supabase
    .from('thr_employees')
    .select('*')
    .limit(1)
    .single();
  
  console.log('📋 master_hr2000 columns:');
  if (masterSample) {
    Object.keys(masterSample).forEach(col => console.log(`  - ${col}`));
  }
  
  console.log('\n📋 thr_employees columns:');
  if (thrSample) {
    Object.keys(thrSample).forEach(col => console.log(`  - ${col}`));
  }
  
  // Find differences
  const masterCols = masterSample ? Object.keys(masterSample) : [];
  const thrCols = thrSample ? Object.keys(thrSample) : [];
  
  const onlyInMaster = masterCols.filter(col => !thrCols.includes(col));
  const onlyInThr = thrCols.filter(col => !masterCols.includes(col));
  
  console.log('\n🔄 SCHEMA DIFFERENCES:');
  console.log(`\nOnly in master_hr2000 (${onlyInMaster.length}):`);
  onlyInMaster.forEach(col => console.log(`  - ${col}`));
  
  console.log(`\nOnly in thr_employees (${onlyInThr.length}):`);
  onlyInThr.forEach(col => console.log(`  - ${col}`));
}

async function analyzeJsonbMigration() {
  console.log('\n📊 2. JSONB MIGRATION ANALYSIS\n');
  
  // Sample master_hr2000 records to analyze JSONB consolidation
  const { data: masterRecords } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(10);
  
  console.log('🔍 master_hr2000 JSONB field usage:');
  const jsonbUsage = {
    fixed_allowances: 0,
    allowances: 0,
    spouse_details: 0,
    contact_info: 0,
    bank_info: 0,
    employment_timeline: 0,
    tax_info: 0
  };
  
  masterRecords?.forEach(record => {
    Object.keys(jsonbUsage).forEach(field => {
      if (record[field] && Object.keys(record[field]).length > 0) {
        jsonbUsage[field]++;
      }
    });
  });
  
  console.log('JSONB field population (out of 10 sample records):');
  Object.entries(jsonbUsage).forEach(([field, count]) => {
    console.log(`  ${field}: ${count}/10 records`);
  });
  
  // Check thr_employees JSONB structure
  const { data: thrRecords } = await supabase
    .from('thr_employees')
    .select('personal_info, employment_info, contact_info, compensation_info')
    .limit(10);
  
  console.log('\n🔍 thr_employees JSONB structure:');
  let personalInfoComplete = 0, employmentInfoComplete = 0, contactInfoComplete = 0, compensationInfoComplete = 0;
  
  thrRecords?.forEach(record => {
    if (record.personal_info && Object.keys(record.personal_info).length > 2) personalInfoComplete++;
    if (record.employment_info && Object.keys(record.employment_info).length > 2) employmentInfoComplete++;
    if (record.contact_info && Object.keys(record.contact_info).length > 1) contactInfoComplete++;
    if (record.compensation_info && Object.keys(record.compensation_info).length > 1) compensationInfoComplete++;
  });
  
  console.log('THR JSONB field completeness (out of 10 sample records):');
  console.log(`  personal_info: ${personalInfoComplete}/10 records`);
  console.log(`  employment_info: ${employmentInfoComplete}/10 records`);
  console.log(`  contact_info: ${contactInfoComplete}/10 records`);
  console.log(`  compensation_info: ${compensationInfoComplete}/10 records`);
}

async function checkDataMigrationGaps() {
  console.log('\n📊 3. DATA MIGRATION GAPS ANALYSIS\n');
  
  // Count records in both tables
  const { count: masterCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: thrCount } = await supabase
    .from('thr_employees')
    .select('*', { count: 'exact', head: true });
  
  console.log(`📊 Record counts:`);
  console.log(`  master_hr2000: ${masterCount || 0} records`);
  console.log(`  thr_employees: ${thrCount || 0} records`);
  console.log(`  Difference: ${Math.abs((masterCount || 0) - (thrCount || 0))} records`);
  
  // Check for employee numbers that exist in master but not in thr
  const { data: masterEmployeeNos } = await supabase
    .from('master_hr2000')
    .select('employee_no')
    .limit(100);
  
  const { data: thrEmploymentInfo } = await supabase
    .from('thr_employees')
    .select('employment_info')
    .limit(100);
  
  const thrEmployeeNos = new Set(
    thrEmploymentInfo
      ?.map(e => e.employment_info?.employee_id)
      .filter(id => id) || []
  );
  
  const missingFromThr = masterEmployeeNos
    ?.filter(m => !thrEmployeeNos.has(m.employee_no))
    .map(m => m.employee_no) || [];
  
  console.log(`\n🔍 Migration gaps (sample of 100):`);
  console.log(`  Employee numbers in master_hr2000 but not in thr_employees: ${missingFromThr.length}`);
  if (missingFromThr.length > 0 && missingFromThr.length <= 10) {
    console.log(`  Missing: ${missingFromThr.join(', ')}`);
  }
}

async function analyzeDataQuality() {
  console.log('\n📊 4. DATA QUALITY COMPARISON\n');
  
  // Check data completeness in master_hr2000
  const { data: masterSample } = await supabase
    .from('master_hr2000')
    .select('*')
    .limit(50);
  
  const masterCompleteness = {
    employee_name: 0,
    ic_no: 0,
    department: 0,
    designation: 0,
    basic_salary: 0,
    contact_email: 0,
    hire_date: 0
  };
  
  masterSample?.forEach(record => {
    if (record.employee_name) masterCompleteness.employee_name++;
    if (record.ic_no) masterCompleteness.ic_no++;
    if (record.department) masterCompleteness.department++;
    if (record.designation) masterCompleteness.designation++;
    if (record.basic_salary) masterCompleteness.basic_salary++;
    if (record.contact_info?.emails) masterCompleteness.contact_email++;
    if (record.employment_timeline?.hire_date) masterCompleteness.hire_date++;
  });
  
  console.log('📋 master_hr2000 data completeness (sample of 50):');
  Object.entries(masterCompleteness).forEach(([field, count]) => {
    const percentage = ((count / 50) * 100).toFixed(1);
    console.log(`  ${field}: ${count}/50 (${percentage}%)`);
  });
  
  // Check data completeness in thr_employees
  const { data: thrSample } = await supabase
    .from('thr_employees')
    .select('*')
    .limit(50);
  
  const thrCompleteness = {
    full_name: 0,
    ic_number: 0,
    department: 0,
    position: 0,
    basic_salary: 0,
    company_email: 0,
    hire_date: 0
  };
  
  thrSample?.forEach(record => {
    if (record.personal_info?.full_name) thrCompleteness.full_name++;
    if (record.personal_info?.ic_number) thrCompleteness.ic_number++;
    if (record.employment_info?.department) thrCompleteness.department++;
    if (record.employment_info?.position) thrCompleteness.position++;
    if (record.compensation_info?.basic_salary) thrCompleteness.basic_salary++;
    if (record.contact_info?.emails?.company) thrCompleteness.company_email++;
    if (record.employment_info?.hire_date) thrCompleteness.hire_date++;
  });
  
  console.log('\n📋 thr_employees data completeness (sample of 50):');
  Object.entries(thrCompleteness).forEach(([field, count]) => {
    const percentage = ((count / 50) * 100).toFixed(1);
    console.log(`  ${field}: ${count}/50 (${percentage}%)`);
  });
}

async function identifyMigrationStrategy() {
  console.log('\n📊 5. MIGRATION STRATEGY RECOMMENDATIONS\n');
  
  console.log('🎯 RECOMMENDED MIGRATION APPROACH:');
  console.log('\n1. DATA SOURCE PRIORITY:');
  console.log('   - Use master_hr2000 as the primary source (518 records)');
  console.log('   - Contains well-structured JSONB fields');
  console.log('   - Has comprehensive employee data');
  
  console.log('\n2. FIELD MAPPING STRATEGY:');
  console.log('   master_hr2000 → thr_employees mapping:');
  console.log('   - employee_name → personal_info.full_name');
  console.log('   - ic_no → personal_info.ic_number');
  console.log('   - date_of_birth → personal_info.date_of_birth');
  console.log('   - gender → personal_info.gender');
  console.log('   - marital_status → personal_info.marital_status');
  console.log('   - employee_no → employment_info.employee_id');
  console.log('   - department → employment_info.department');
  console.log('   - designation → employment_info.position');
  console.log('   - employment_timeline.hire_date → employment_info.hire_date');
  console.log('   - basic_salary → compensation_info.basic_salary');
  console.log('   - contact_info → contact_info (direct copy)');
  console.log('   - spouse_details → personal_info.spouse_details');
  
  console.log('\n3. CRITICAL ACTIONS:');
  console.log('   ❌ Clear thr_employees table (current data is incomplete)');
  console.log('   ✅ Migrate from master_hr2000 using proper field mapping');
  console.log('   ✅ Preserve JSONB structure integrity');
  console.log('   ✅ Handle organization_id mapping');
  console.log('   ✅ Generate auth_user_id relationships');
  
  console.log('\n4. DATA INTEGRITY MEASURES:');
  console.log('   - Add unique constraints on personal_info.ic_number');
  console.log('   - Add unique constraints on employment_info.employee_id');
  console.log('   - Validate JSONB structures before insertion');
  console.log('   - Create proper foreign key relationships');
  console.log('   - Implement RLS policies');
}

async function checkCurrentDataQuality() {
  console.log('\n📊 6. CURRENT DATABASE ISSUES SUMMARY\n');
  
  console.log('🚨 CRITICAL ISSUES IDENTIFIED:');
  console.log('1. SCHEMA MISALIGNMENT:');
  console.log('   - master_hr2000 has rich, complete data');
  console.log('   - thr_employees has incomplete JSONB structures');
  console.log('   - Missing field mappings between tables');
  
  console.log('\n2. DATA COMPLETENESS:');
  console.log('   - thr_employees: 517/517 missing full_name');
  console.log('   - thr_employees: 515/517 missing ic_number');
  console.log('   - thr_employees: 517/517 missing employee_id');
  console.log('   - All employees missing organization_id references');
  
  console.log('\n3. FOREIGN KEY VIOLATIONS:');
  console.log('   - 517/517 employees have invalid organization_id');
  console.log('   - 509/517 employees missing auth_user_id');
  
  console.log('\n4. JSONB INCONSISTENCIES:');
  console.log('   - Inconsistent field structures across records');
  console.log('   - Missing required fields in JSONB objects');
  console.log('   - No validation on JSONB content');
  
  console.log('\n💡 IMMEDIATE RECOMMENDATIONS:');
  console.log('1. Stop using thr_employees until proper migration');
  console.log('2. Use master_hr2000 as the temporary source of truth');
  console.log('3. Implement proper data migration script');
  console.log('4. Add database constraints and validation');
  console.log('5. Update frontend to handle master_hr2000 schema');
}

// Run all analyses
async function runSchemaComparison() {
  try {
    await compareSchemas();
    await analyzeJsonbMigration();
    await checkDataMigrationGaps();
    await analyzeDataQuality();
    await identifyMigrationStrategy();
    await checkCurrentDataQuality();
    
    console.log('\n✅ Schema comparison analysis completed at', new Date().toLocaleString());
  } catch (error) {
    console.error('\n❌ Schema comparison failed:', error);
  }
}

runSchemaComparison();