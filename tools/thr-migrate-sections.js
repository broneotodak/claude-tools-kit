#!/usr/bin/env node

/**
 * Migrate existing section data in master_hr2000 table
 * This preserves any existing section data that might have been manually entered
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function migrateExistingSections() {
  console.log('🔧 THR Section Migration Tool\n');
  console.log('=' .repeat(60));
  
  // First, check current state
  console.log('\n📊 Checking current section data...\n');
  
  // Get all employees with sections
  const { data: existingData, error: fetchError } = await supabase
    .from('master_hr2000')
    .select('id, employee_no, employee_name, section')
    .not('section', 'is', null);
  
  if (fetchError) {
    console.error('❌ Error fetching data:', fetchError);
    return;
  }
  
  console.log(`Found ${existingData.length} employees with section data`);
  
  // Get section distribution
  const sectionCount = {};
  existingData.forEach(emp => {
    const section = emp.section;
    sectionCount[section] = (sectionCount[section] || 0) + 1;
  });
  
  console.log('\n📋 Current Section Distribution:');
  Object.entries(sectionCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([section, count]) => {
      console.log(`  ${section}: ${count} employees`);
    });
  
  // Check for any employees without sections
  const { count: withoutSection } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .is('section', null);
  
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  console.log('\n📊 Coverage Statistics:');
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With section: ${existingData.length} (${((existingData.length/totalCount)*100).toFixed(1)}%)`);
  console.log(`  Without section: ${withoutSection} (${((withoutSection/totalCount)*100).toFixed(1)}%)`);
  
  // Show sample of employees with sections
  console.log('\n📋 Sample employees with sections:');
  existingData.slice(0, 10).forEach(emp => {
    console.log(`  ${emp.employee_no}: ${emp.employee_name || 'NO NAME'} → ${emp.section}`);
  });
  
  // Check if there are any conflicts or duplicates
  const employeeNos = existingData.map(e => e.employee_no);
  const uniqueEmployeeNos = [...new Set(employeeNos)];
  
  if (employeeNos.length !== uniqueEmployeeNos.length) {
    console.log('\n⚠️  Warning: Found duplicate employee numbers with sections');
  }
  
  // Summary report
  console.log('\n' + '=' .repeat(60));
  console.log('\n✅ Migration Check Complete!');
  console.log('\nSummary:');
  console.log(`- ${existingData.length} employees already have section data`);
  console.log(`- ${Object.keys(sectionCount).length} unique sections found`);
  console.log(`- ${withoutSection} employees still need section assignment`);
  
  // Recommendations
  if (withoutSection > 0) {
    console.log('\n💡 Recommendations:');
    console.log('1. The thr-fix-section.js script has already populated sections from raw data');
    console.log('2. Remaining employees without sections might be:');
    console.log('   - New employees added after the HR2000 export');
    console.log('   - Employees with missing section data in source files');
    console.log('   - Manual entries that need section assignment');
  }
  
  // Export section list for reference
  const sectionList = Object.keys(sectionCount).sort();
  console.log('\n📝 All Current Sections (for reference):');
  sectionList.forEach((section, index) => {
    console.log(`${(index + 1).toString().padStart(2, ' ')}. ${section}`);
  });
}

// Main execution
async function main() {
  try {
    await migrateExistingSections();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}