#!/usr/bin/env node

/**
 * Fix email mapping in master_hr2000 table
 * Moves company emails to company_email field and keeps personal emails in personal_email
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Company email domains
const COMPANY_DOMAINS = [
  'todak.com',
  'todak.my',
  'sarcom.com',
  'sarcom.my',
  'neotodak.com',
  'neotodak.my',
  'todak.io',
  'todak.edu.my'
];

// Check if email is a company email
function isCompanyEmail(email) {
  if (!email) return false;
  
  const lowercaseEmail = email.toLowerCase();
  return COMPANY_DOMAINS.some(domain => lowercaseEmail.endsWith(`@${domain}`));
}

// Process and migrate emails
async function migrateEmails() {
  console.log('📧 Fetching all employees with email data...\n');
  
  // Get all employees with personal_email
  const { data: employees, error: fetchError } = await supabase
    .from('master_hr2000')
    .select('id, employee_no, employee_name, personal_email, company_email')
    .not('personal_email', 'is', null);
  
  if (fetchError) {
    console.error('❌ Error fetching data:', fetchError);
    return;
  }
  
  console.log(`Found ${employees.length} employees with email data\n`);
  
  // Categorize emails
  const toMigrate = [];
  const alreadyCorrect = [];
  const personalEmails = [];
  
  employees.forEach(emp => {
    const email = emp.personal_email;
    
    if (isCompanyEmail(email)) {
      // This is a company email that needs to move
      toMigrate.push({
        ...emp,
        new_company_email: email,
        new_personal_email: null
      });
    } else {
      // This is correctly a personal email
      personalEmails.push(emp);
    }
  });
  
  // Check for employees who already have company_email
  const withCompanyEmail = employees.filter(emp => emp.company_email);
  
  console.log('📊 Email Distribution Analysis:');
  console.log(`  Total with emails: ${employees.length}`);
  console.log(`  Company emails in personal_email field: ${toMigrate.length}`);
  console.log(`  Personal emails (correct): ${personalEmails.length}`);
  console.log(`  Already have company_email: ${withCompanyEmail.length}\n`);
  
  // Show sample of emails to migrate
  if (toMigrate.length > 0) {
    console.log('📋 Sample company emails to migrate:');
    toMigrate.slice(0, 10).forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.personal_email} → company_email`);
    });
    console.log('');
  }
  
  // Show sample of personal emails
  if (personalEmails.length > 0) {
    console.log('📋 Sample personal emails (will remain):');
    personalEmails.slice(0, 5).forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.personal_email}`);
    });
    console.log('');
  }
  
  return toMigrate;
}

// Update database
async function updateDatabase(toMigrate) {
  if (toMigrate.length === 0) {
    console.log('✅ No emails need migration!');
    return;
  }
  
  console.log(`\n💾 Migrating ${toMigrate.length} company emails...\n`);
  
  let migrated = 0;
  let errors = 0;
  
  // Update in batches
  for (let i = 0; i < toMigrate.length; i += 50) {
    const batch = toMigrate.slice(i, i + 50);
    
    for (const emp of batch) {
      const { error } = await supabase
        .from('master_hr2000')
        .update({
          company_email: emp.new_company_email,
          personal_email: emp.new_personal_email
        })
        .eq('id', emp.id);
      
      if (!error) {
        migrated++;
        if (migrated % 50 === 0) {
          console.log(`  ✓ Migrated ${migrated} emails...`);
        }
      } else {
        errors++;
        console.error(`  ❌ Error updating ${emp.employee_no}: ${error.message}`);
      }
    }
  }
  
  console.log(`\n✅ Successfully migrated: ${migrated} emails`);
  if (errors > 0) {
    console.log(`❌ Errors: ${errors} records`);
  }
  
  return migrated;
}

// Verify final state
async function verifyFinalState() {
  console.log('\n🔍 Verifying final email distribution...\n');
  
  // Get updated statistics
  const { count: totalCount } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true });
  
  const { count: withPersonalEmail } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('personal_email', 'is', null);
  
  const { count: withCompanyEmail } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('company_email', 'is', null);
  
  const { count: withBothEmails } = await supabase
    .from('master_hr2000')
    .select('*', { count: 'exact', head: true })
    .not('personal_email', 'is', null)
    .not('company_email', 'is', null);
  
  console.log('📊 Final Email Statistics:');
  console.log(`  Total employees: ${totalCount}`);
  console.log(`  With personal email: ${withPersonalEmail} (${((withPersonalEmail/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With company email: ${withCompanyEmail} (${((withCompanyEmail/totalCount)*100).toFixed(1)}%)`);
  console.log(`  With both emails: ${withBothEmails}`);
  
  // Show samples
  const { data: companySamples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, company_email')
    .not('company_email', 'is', null)
    .limit(10);
  
  if (companySamples && companySamples.length > 0) {
    console.log('\n📋 Sample company emails:');
    companySamples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.company_email}`);
    });
  }
  
  const { data: personalSamples } = await supabase
    .from('master_hr2000')
    .select('employee_no, employee_name, personal_email')
    .not('personal_email', 'is', null)
    .limit(5);
  
  if (personalSamples && personalSamples.length > 0) {
    console.log('\n📋 Sample personal emails:');
    personalSamples.forEach(emp => {
      console.log(`  ${emp.employee_no}: ${emp.personal_email}`);
    });
  }
  
  // Check for any remaining company emails in personal_email field
  const { data: remainingCompany } = await supabase
    .from('master_hr2000')
    .select('employee_no, personal_email')
    .not('personal_email', 'is', null);
  
  const stillWrong = remainingCompany?.filter(emp => isCompanyEmail(emp.personal_email)) || [];
  
  if (stillWrong.length > 0) {
    console.log(`\n⚠️  Warning: Found ${stillWrong.length} company emails still in personal_email field`);
    console.log('These might be edge cases or new entries.');
  }
}

// Main
async function main() {
  console.log('🔧 THR Email Field Mapping Fix\n');
  console.log('=' .repeat(60));
  console.log('\nThis tool will:');
  console.log('- Move company emails (@todak.com, @sarcom.com, etc) to company_email field');
  console.log('- Keep personal emails (gmail, yahoo, etc) in personal_email field\n');
  console.log('=' .repeat(60) + '\n');
  
  // Analyze current state
  const toMigrate = await migrateEmails();
  
  if (!toMigrate) {
    console.log('\n❌ Failed to analyze emails');
    return;
  }
  
  // Perform migration
  await updateDatabase(toMigrate);
  
  // Verify results
  await verifyFinalState();
  
  console.log('\n✅ Email migration complete!');
}

if (require.main === module) {
  main().catch(console.error);
}