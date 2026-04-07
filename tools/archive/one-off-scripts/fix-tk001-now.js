const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const tk001Id = '03e0f1cf-9d65-4272-9e0f-184c44d5b80a';

  console.log('=== Fixing TK001 - Removing auth_user_id ===\n');

  // Update
  const { data, error } = await supabase
    .from('thr_employees')
    .update({ auth_user_id: null })
    .eq('id', tk001Id)
    .select('employee_no, auth_user_id');

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }

  console.log('Update result:', data);

  // Verify immediately
  const { data: verify } = await supabase
    .from('thr_employees')
    .select('employee_no, auth_user_id')
    .eq('id', tk001Id)
    .single();

  console.log('\nVerification:');
  console.log('  TK001 auth_user_id:', verify?.auth_user_id);

  if (verify?.auth_user_id === null) {
    console.log('\n✓ SUCCESS - TK001 is now unlinked');
  } else {
    console.log('\n❌ FAILED - auth_user_id still set!');
  }

  // Final check - how many active employees have this auth_user_id now?
  const authUserId = '8f669a61-a5a7-4759-83e7-5561795d2346';
  const { data: remaining } = await supabase
    .from('thr_employees')
    .select('employee_no, access_level')
    .eq('auth_user_id', authUserId)
    .eq('employment_info->>employment_status', 'active');

  console.log('\nActive employees with this auth_user_id:', remaining?.length);
  remaining?.forEach(e => console.log('  -', e.employee_no, '| Level:', e.access_level));
})().catch(console.error);
