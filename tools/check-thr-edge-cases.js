const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkEdgeCases() {
  console.log('🔍 THR EDGE CASES ANALYSIS\n');
  console.log('='.repeat(60));

  try {
    // 1. Check users without department/section/position
    console.log('1. USERS WITHOUT DEPARTMENT/SECTION/POSITION:\n');
    
    const { data: noDept } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info, access_level')
      .or('employment_info->>department.is.null,employment_info->>section.is.null,employment_info->>designation.is.null')
      .limit(10);

    if (noDept && noDept.length > 0) {
      console.log(`Found ${noDept.length} employees with missing info:`);
      noDept.forEach(emp => {
        const info = emp.employment_info || {};
        console.log(`- ${emp.full_name} (Level ${emp.access_level})`);
        console.log(`  Dept: ${info.department || 'MISSING'} | Section: ${info.section || 'MISSING'} | Position: ${info.designation || 'MISSING'}`);
      });
    } else {
      console.log('✅ All employees have department/section/position');
    }

    // 2. Check users without reporting_to
    console.log('\n2. USERS WITHOUT MANAGERS (reporting_to):\n');
    
    const { data: noManager, count: noManagerCount } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info, access_level', { count: 'exact' })
      .is('employment_info->>reporting_to', null);

    console.log(`Total employees without managers: ${noManagerCount || 0}`);
    
    if (noManager && noManager.length > 0) {
      // Check who these are
      const levelBreakdown = {};
      noManager.forEach(emp => {
        const level = emp.access_level || 0;
        levelBreakdown[level] = (levelBreakdown[level] || 0) + 1;
      });
      
      console.log('Breakdown by access level:');
      Object.keys(levelBreakdown).sort().forEach(level => {
        console.log(`  Level ${level}: ${levelBreakdown[level]} employees`);
      });
      
      // Show some examples
      console.log('\nExamples:');
      noManager.slice(0, 5).forEach(emp => {
        console.log(`- ${emp.full_name} (Level ${emp.access_level}) - ${emp.employment_info?.designation || 'No position'}`);
      });
    }

    // 3. Check Level 7 users and their organizations
    console.log('\n3. LEVEL 7 USERS (C-Suite with org restrictions):\n');
    
    const { data: level7Users } = await supabase
      .from('thr_employees')
      .select('id, full_name, organization_id, assigned_organizations')
      .eq('access_level', 7);

    if (level7Users && level7Users.length > 0) {
      console.log(`Found ${level7Users.length} Level 7 users:`);
      level7Users.forEach(user => {
        console.log(`\n- ${user.full_name}`);
        console.log(`  Primary Org: ${user.organization_id || 'NONE'}`);
        console.log(`  Assigned Orgs: ${user.assigned_organizations ? JSON.stringify(user.assigned_organizations) : 'NONE'}`);
      });
    } else {
      console.log('No Level 7 users found');
    }

    // 4. Check how the system handles these cases
    console.log('\n4. SYSTEM BEHAVIOR ANALYSIS:\n');
    
    // Check if there are any RLS policies that might fail
    console.log('Potential issues:');
    console.log('- Leave approval: Users without managers have no approver');
    console.log('- Claim approval: May need manager approval');
    console.log('- Organization visibility: Level 7 without assigned_organizations sees nothing');
    
    // Check actual RLS policies for organization filtering
    console.log('\n5. ORGANIZATION FILTERING FOR LEVEL 7:\n');
    console.log('Level 7 users should only see employees where:');
    console.log('- employee.organization_id IN user.assigned_organizations');
    console.log('- This is enforced by RLS policies (must check in Supabase dashboard)');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkEdgeCases();