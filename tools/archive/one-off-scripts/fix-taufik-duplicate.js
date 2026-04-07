const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  const tk001Id = '03e0f1cf-9d65-4272-9e0f-184c44d5b80a';  // TK001 - Level 0 (to unlink)
  const ta007Id = '74a9809a-bfa3-4cfa-9b6b-34520824ba2c';  // TA007 - Level 7 (keep linked)

  console.log('=== Fixing TAUFIK duplicate auth_user_id ===\n');

  // Step 1: Remove auth_user_id from TK001
  console.log('Step 1: Unlinking TK001 from auth account...');
  const { error: updateErr } = await supabase
    .from('thr_employees')
    .update({ auth_user_id: null })
    .eq('id', tk001Id);

  if (updateErr) {
    console.log('❌ Error:', updateErr.message);
    return;
  }
  console.log('✓ TK001 unlinked from auth account');

  // Step 2: Verify TA007 still has the auth_user_id
  const { data: ta007 } = await supabase
    .from('thr_employees')
    .select('employee_no, full_name, access_level, auth_user_id')
    .eq('id', ta007Id)
    .single();

  console.log('\nStep 2: Verifying TA007...');
  console.log('Employee:', ta007?.employee_no, '-', ta007?.full_name);
  console.log('Access Level:', ta007?.access_level);
  console.log('Auth User ID:', ta007?.auth_user_id);

  // Step 3: Verify TK001 is unlinked
  const { data: tk001 } = await supabase
    .from('thr_employees')
    .select('employee_no, full_name, access_level, auth_user_id')
    .eq('id', tk001Id)
    .single();

  console.log('\nStep 3: Verifying TK001 is unlinked...');
  console.log('Employee:', tk001?.employee_no, '-', tk001?.full_name);
  console.log('Access Level:', tk001?.access_level);
  console.log('Auth User ID:', tk001?.auth_user_id, '(should be null)');

  console.log('\n✓ Fix applied! Now only TA007 is linked to login.');
  console.log('\n⚠️  BUT TA007 still has NO organization assignments!');
  console.log('   Need to add org assignments for Level 7 to work properly.');
})().catch(console.error);
