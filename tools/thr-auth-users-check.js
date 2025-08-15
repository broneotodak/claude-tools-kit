const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkAuthUsers() {
  console.log('🔐 THR AUTH USERS ANALYSIS\n');
  console.log('='.repeat(60));

  try {
    // 1. Check employees with auth_user_id
    const { data: withAuth, count: withAuthCount } = await supabase
      .from('thr_employees')
      .select('id, full_name, auth_user_id, employment_info', { count: 'exact' })
      .not('auth_user_id', 'is', null)
      .limit(10);

    console.log(`\n✅ Employees WITH auth_user_id: ${withAuthCount || 0}`);
    if (withAuth && withAuth.length > 0) {
      console.log('Sample users who can login:');
      withAuth.forEach(emp => {
        console.log(`- ${emp.full_name} (${emp.employment_info?.employee_id || 'No ID'})`);
      });
    }

    // 2. Check employees without auth_user_id
    const { count: withoutAuthCount } = await supabase
      .from('thr_employees')
      .select('*', { count: 'exact', head: true })
      .is('auth_user_id', null);

    console.log(`\n⚠️  Employees WITHOUT auth_user_id: ${withoutAuthCount || 0}`);
    console.log('These employees cannot login to the system');

    // 3. Check access levels distribution
    console.log('\n📊 ACCESS LEVELS DISTRIBUTION:');
    const { data: allEmps } = await supabase
      .from('thr_employees')
      .select('access_level');

    if (allEmps) {
      const levelCounts = {};
      allEmps.forEach(emp => {
        const level = emp.access_level || 0;
        levelCounts[level] = (levelCounts[level] || 0) + 1;
      });

      Object.keys(levelCounts).sort().forEach(level => {
        console.log(`Level ${level}: ${levelCounts[level]} employees`);
      });
    }

    // 4. Check organizations
    console.log('\n🏢 ORGANIZATIONS:');
    const { data: orgs } = await supabase
      .from('thr_organizations')
      .select('code, name, is_active')
      .order('code');

    if (orgs) {
      orgs.forEach(org => {
        console.log(`- ${org.code}: ${org.name} (${org.is_active ? 'Active' : 'Inactive'})`);
      });
    }

    // 5. Recent login activity (if tracked)
    console.log('\n📅 SYSTEM USAGE:');
    const { data: recentActivity } = await supabase
      .from('thr_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentActivity && recentActivity.length > 0) {
      console.log('Recent activity:');
      recentActivity.forEach(log => {
        console.log(`- ${log.activity_type} by ${log.employee_id} at ${new Date(log.created_at).toLocaleString()}`);
      });
    } else {
      console.log('No activity logs found (table might not exist or be empty)');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkAuthUsers();