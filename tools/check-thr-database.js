const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabase() {
  console.log('🔍 CTK: Checking THR Database\n');
  console.log('Database URL: https://ftbtsxlujsnobujwekwx.supabase.co');
  console.log('='.repeat(60));

  try {
    // 1. Count employees
    console.log('\n1. Employee count:');
    const { count: empCount } = await supabase
      .from('thr_employees')
      .select('*', { count: 'exact', head: true });
    console.log(`   Total employees: ${empCount || 0}`);

    // 2. Count claims
    console.log('\n2. Claims count:');
    const { count: claimCount } = await supabase
      .from('thr_claims')
      .select('*', { count: 'exact', head: true });
    console.log(`   Total claims: ${claimCount || 0}`);

    // 3. List first 5 employees
    console.log('\n3. First 5 employees:');
    const { data: employees } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info')
      .limit(5);

    if (employees && employees.length > 0) {
      employees.forEach(emp => {
        console.log(`   - ${emp.full_name} (ID: ${emp.id.substring(0, 8)}...)`);
      });
    }

    // 4. Check recent claims
    console.log('\n4. Recent claims:');
    const { data: claims } = await supabase
      .from('thr_claims')
      .select('claim_no, claim_type, employee_id, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (claims && claims.length > 0) {
      claims.forEach(claim => {
        console.log(`   - ${claim.claim_no} (${claim.claim_type}) - Employee: ${claim.employee_id?.substring(0, 8)}...`);
      });
    }

    // 5. Check storage buckets
    console.log('\n5. Storage buckets:');
    const { data: buckets } = await supabase.storage.listBuckets();
    if (buckets) {
      buckets.forEach(bucket => {
        console.log(`   - ${bucket.name} (${bucket.public ? 'public' : 'private'})`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkDatabase();