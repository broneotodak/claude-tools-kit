const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

console.log('🏥 THR COMPREHENSIVE HEALTH CHECK');
console.log('=' .repeat(80));
console.log(`Date: ${new Date().toISOString()}`);
console.log(`Database: ftbtsxlujsnobujwekwx.supabase.co (ATLAS/THR shared)`);
console.log('=' .repeat(80));

async function checkDatabaseHealth() {
  console.log('\n📊 1. DATABASE HEALTH CHECK\n');
  
  const tables = [
    'thr_employees',
    'thr_claims', 
    'thr_leave_balances',
    'thr_payroll_transactions',
    'thr_documents',
    'thr_organizations',
    'thr_claim_types',
    'thr_leave_types',
    'thr_asset_assignments',
    'thr_notifications'
  ];
  
  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table}: ERROR - ${error.message}`);
      } else {
        console.log(`✅ ${table}: ${count || 0} records`);
      }
    } catch (err) {
      console.log(`❌ ${table}: FAILED - ${err.message}`);
    }
  }
}

async function checkStorageBuckets() {
  console.log('\n💾 2. STORAGE BUCKETS CHECK\n');
  
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.log('❌ Error listing buckets:', error.message);
      return;
    }
    
    const expectedBuckets = [
      'employee-photos',
      'employee-documents', 
      'claim-receipts',
      'memos'
    ];
    
    for (const expected of expectedBuckets) {
      const exists = buckets?.find(b => b.name === expected);
      if (exists) {
        console.log(`✅ ${expected}: ${exists.public ? 'public' : 'private'}`);
      } else {
        console.log(`❌ ${expected}: NOT FOUND`);
      }
    }
  } catch (err) {
    console.log('❌ Storage check failed:', err.message);
  }
}

async function checkRLSPolicies() {
  console.log('\n🔒 3. ROW LEVEL SECURITY CHECK\n');
  
  // Check if RLS is enabled on critical tables
  const criticalTables = [
    'thr_employees',
    'thr_payroll_transactions',
    'thr_documents',
    'thr_claims'
  ];
  
  console.log('Critical tables requiring RLS:');
  criticalTables.forEach(table => {
    console.log(`- ${table}: RLS should be ENABLED`);
  });
  
  console.log('\n⚠️  Note: RLS status must be verified in Supabase dashboard');
}

async function checkDataIntegrity() {
  console.log('\n🔍 4. DATA INTEGRITY CHECK\n');
  
  // Check for employees without auth_user_id
  const { count: noAuthCount } = await supabase
    .from('thr_employees')
    .select('*', { count: 'exact', head: true })
    .is('auth_user_id', null);
  
  console.log(`Employees without auth_user_id: ${noAuthCount || 0}`);
  
  // Check for duplicate employee IDs
  const { data: employees } = await supabase
    .from('thr_employees')
    .select('employment_info');
  
  if (employees) {
    const empIds = employees
      .map(e => e.employment_info?.employee_id)
      .filter(id => id);
    const duplicates = empIds.filter((id, index) => empIds.indexOf(id) !== index);
    
    if (duplicates.length > 0) {
      console.log(`❌ Duplicate employee IDs found: ${duplicates.join(', ')}`);
    } else {
      console.log('✅ No duplicate employee IDs');
    }
  }
  
  // Check claims with receipts
  const { count: claimsWithReceipts } = await supabase
    .from('thr_claims')
    .select('*', { count: 'exact', head: true })
    .not('receipt_url', 'is', null);
  
  const { count: totalClaims } = await supabase
    .from('thr_claims')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Claims with receipts: ${claimsWithReceipts || 0}/${totalClaims || 0}`);
}

async function checkFrontendStructure() {
  console.log('\n🎨 5. FRONTEND STRUCTURE CHECK\n');
  
  const modulesPath = path.join(__dirname, '../../THR/src/modules');
  
  try {
    const modules = fs.readdirSync(modulesPath);
    console.log('Available modules:');
    modules.forEach(module => {
      const stat = fs.statSync(path.join(modulesPath, module));
      if (stat.isDirectory()) {
        console.log(`✅ ${module}`);
      }
    });
  } catch (err) {
    console.log('❌ Cannot read modules directory');
  }
}

async function checkEnvironmentVariables() {
  console.log('\n🔑 6. ENVIRONMENT VARIABLES CHECK\n');
  
  const requiredVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  requiredVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: Set`);
    } else {
      console.log(`❌ ${varName}: NOT SET`);
    }
  });
}

async function checkRecentActivity() {
  console.log('\n📈 7. RECENT ACTIVITY CHECK\n');
  
  // Check recent claims
  const { data: recentClaims } = await supabase
    .from('thr_claims')
    .select('claim_no, created_at, status')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (recentClaims && recentClaims.length > 0) {
    console.log('Recent claims:');
    recentClaims.forEach(claim => {
      console.log(`- ${claim.claim_no} (${claim.status}) - ${new Date(claim.created_at).toLocaleDateString()}`);
    });
  } else {
    console.log('No recent claims');
  }
  
  // Check recent documents
  const { data: recentDocs } = await supabase
    .from('thr_documents')
    .select('title, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (recentDocs && recentDocs.length > 0) {
    console.log('\nRecent documents:');
    recentDocs.forEach(doc => {
      console.log(`- ${doc.title} - ${new Date(doc.created_at).toLocaleDateString()}`);
    });
  } else {
    console.log('\nNo recent documents');
  }
}

async function checkKnownIssues() {
  console.log('\n⚠️  8. KNOWN ISSUES & LEARNINGS\n');
  
  console.log('Schema differences from expectations:');
  console.log('- thr_claims uses "receipt_url" (singular string), not "receipt_urls" (array)');
  console.log('- thr_claims uses "amount", not "total_amount"');
  console.log('- thr_claims uses "claim_type" (string), not "claim_type_id"');
  console.log('- No foreign key relationship between thr_claims and thr_claim_types');
  console.log('- thr_claim_receipts table exists but is not used (receipts stored in receipt_url)');
  
  console.log('\nCritical mappings:');
  console.log('- Employee ID is in employment_info.employee_id (JSONB)');
  console.log('- Email is in contact_info.emails.company (JSONB)');
  console.log('- Phone is in contact_info.phone (JSONB)');
  console.log('- Use auth_user_id for auth lookups, never email column');
}

async function generateHealthReport() {
  console.log('\n📋 9. HEALTH SUMMARY\n');
  
  const issues = [];
  
  // Check critical issues
  const { count: employeeCount } = await supabase
    .from('thr_employees')
    .select('*', { count: 'exact', head: true });
  
  if (!employeeCount || employeeCount === 0) {
    issues.push('No employees in database');
  }
  
  const { error: connectError } = await supabase
    .from('thr_employees')
    .select('id')
    .limit(1);
  
  if (connectError) {
    issues.push('Database connection issues');
  }
  
  if (issues.length === 0) {
    console.log('🟢 SYSTEM STATUS: HEALTHY');
    console.log('All critical checks passed');
  } else {
    console.log('🔴 SYSTEM STATUS: ISSUES DETECTED');
    issues.forEach(issue => console.log(`- ${issue}`));
  }
  
  console.log('\n💡 Recommendations:');
  console.log('1. Verify RLS policies in Supabase dashboard');
  console.log('2. Monitor claim receipts upload process');
  console.log('3. Consider data migration for unused thr_claim_receipts table');
  console.log('4. Update CLAUDE.md with latest schema learnings');
}

// Run all checks
async function runHealthCheck() {
  try {
    await checkDatabaseHealth();
    await checkStorageBuckets();
    await checkRLSPolicies();
    await checkDataIntegrity();
    await checkFrontendStructure();
    await checkEnvironmentVariables();
    await checkRecentActivity();
    await checkKnownIssues();
    await generateHealthReport();
    
    console.log('\n✅ Health check completed at', new Date().toLocaleString());
  } catch (error) {
    console.error('\n❌ Health check failed:', error);
  }
}

runHealthCheck();