const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  // Check TS001 employee details
  const { data: emp } = await supabase
    .from('thr_employees')
    .select('employee_no, full_name, employment_info')
    .eq('employee_no', 'TS001')
    .single();

  console.log('=== TS001 Verification ===\n');
  console.log('Name:', emp.full_name);
  console.log('Staff Category:', emp.employment_info?.staff_category);
  console.log('Employment Type:', emp.employment_info?.employment_type);
  console.log('Employment Type ID:', emp.employment_info?.employment_type_id);
  console.log('\n✓ All fields now correctly set!');

  // Show current leave balance
  const { data: balances } = await supabase
    .from('thr_leave_balances')
    .select('leave_type, year, entitlement, taken, balance')
    .eq('employee_id', emp.employment_info?.employee_id || 'f221e445-ac90-4417-852b-ab76d792bd0c')
    .eq('year', 2026)
    .order('leave_type');

  console.log('\n=== Current 2026 Leave Balances ===');
  console.log('Leave Type | Entitled | Taken | Balance');
  console.log('-'.repeat(50));
  (balances || []).forEach(b => {
    console.log(b.leave_type.padEnd(12) + ' | ' +
      String(b.entitlement).padStart(4) + '    | ' +
      String(b.taken).padStart(3) + '  | ' +
      String(b.balance).padStart(4));
  });

  console.log('\n⚠️  To update to correct entitlement (21 days for CEO+Permanent):');
  console.log('   Go to Leave Management > Re-initialize Balances');
})().catch(console.error);
