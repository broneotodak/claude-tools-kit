const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkRLSPolicies() {
  console.log('🔒 THR RLS POLICIES CHECK\n');
  console.log('='.repeat(60));
  console.log('Note: This check can only verify if queries work, not if RLS is enabled');
  console.log('You must check Supabase dashboard for actual RLS status\n');

  // Test queries to see if they're restricted
  const testEmployeeId = 'f221e445-ac90-4417-852b-ab76d792bd0c'; // Ahmad Fadli

  try {
    // 1. Try to query all employees (should be restricted if RLS is on)
    console.log('1. Testing thr_employees access:');
    const { data: allEmployees, error: empError } = await supabase
      .from('thr_employees')
      .select('id')
      .limit(5);
    
    if (empError) {
      console.log('❌ Error accessing employees:', empError.message);
    } else {
      console.log(`⚠️  Can access ${allEmployees?.length || 0} employees (service role bypasses RLS)`);
    }

    // 2. Test claims access
    console.log('\n2. Testing thr_claims access:');
    const { data: allClaims } = await supabase
      .from('thr_claims')
      .select('id, employee_id');
    
    if (allClaims) {
      const uniqueEmployees = [...new Set(allClaims.map(c => c.employee_id))];
      console.log(`⚠️  Can see claims from ${uniqueEmployees.length} different employees`);
    }

    // 3. Test payroll access
    console.log('\n3. Testing thr_payroll_transactions access:');
    const { data: payroll } = await supabase
      .from('thr_payroll_transactions')
      .select('employee_id')
      .limit(10);
    
    if (payroll) {
      const uniquePayroll = [...new Set(payroll.map(p => p.employee_id))];
      console.log(`⚠️  Can see payroll for ${uniquePayroll.length} different employees`);
    }

    // 4. Test documents access
    console.log('\n4. Testing thr_documents access:');
    const { data: docs } = await supabase
      .from('thr_documents')
      .select('id, employee_id, document_type');
    
    console.log(`⚠️  Can see ${docs?.length || 0} documents`);

    console.log('\n⚠️  IMPORTANT:');
    console.log('Service role key bypasses RLS, so all queries succeed.');
    console.log('You must check Supabase dashboard to verify RLS is enabled.');
    console.log('\nTo check RLS status:');
    console.log('1. Go to https://supabase.com/dashboard/project/ftbtsxlujsnobujwekwx/editor');
    console.log('2. Click on each table (thr_employees, thr_claims, etc.)');
    console.log('3. Look for "RLS enabled" badge');
    console.log('4. Check Policies tab to see active policies');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkRLSPolicies();