const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeHierarchy() {
  console.log('🏢 THR ORGANIZATIONAL HIERARCHY ANALYSIS\n');
  console.log('='.repeat(80));
  console.log('Following CTK: No assumptions, data-driven approach\n');

  try {
    // 1. Get all organizations
    console.log('1. ORGANIZATIONS IN SYSTEM:\n');
    const { data: orgs, error } = await supabase
      .from('thr_organizations')
      .select('*')
      .order('name');
    
    if (error) {
      console.log('Error fetching organizations:', error.message);
      return;
    }

    if (!orgs || orgs.length === 0) {
      console.log('❌ No organizations found in database');
      return;
    }

    const orgMap = {};
    orgs.forEach(org => {
      orgMap[org.id] = org;
      console.log(`${org.name} (${org.is_active ? 'Active' : 'Inactive'})`);
    });

    // 2. Analyze each organization's hierarchy
    console.log('\n2. HIERARCHY ANALYSIS BY ORGANIZATION:\n');
    
    for (const org of orgs) {
      console.log(`\n${org.name}:`);
      console.log('-'.repeat(50));
      
      // Get all employees in this org
      const { data: employees } = await supabase
        .from('thr_employees')
        .select('id, full_name, employment_info, access_level')
        .eq('organization_id', org.id)
        .order('access_level', { ascending: false });

      if (!employees || employees.length === 0) {
        console.log('No employees in this organization');
        continue;
      }

      // Group by position level
      const hierarchy = {
        directors: [],
        managers: [],
        supervisors: [],
        teamLeads: [],
        regular: [],
        noPosition: []
      };

      employees.forEach(emp => {
        const position = emp.employment_info?.designation?.toUpperCase() || '';
        const dept = emp.employment_info?.department || 'NO DEPT';
        
        const empInfo = {
          id: emp.id,
          name: emp.full_name,
          position: emp.employment_info?.designation || 'NO POSITION',
          department: dept,
          level: emp.access_level
        };

        if (!position || position === 'MISSING') {
          hierarchy.noPosition.push(empInfo);
        } else if (position.includes('DIRECTOR') || position.includes('CEO') || position.includes('CHIEF')) {
          hierarchy.directors.push(empInfo);
        } else if (position.includes('MANAGER') || position.includes('HEAD')) {
          hierarchy.managers.push(empInfo);
        } else if (position.includes('SUPERVISOR') || position.includes('SENIOR')) {
          hierarchy.supervisors.push(empInfo);
        } else if (position.includes('LEAD') || position.includes('COORDINATOR')) {
          hierarchy.teamLeads.push(empInfo);
        } else {
          hierarchy.regular.push(empInfo);
        }
      });

      // Display hierarchy
      console.log(`\nTotal Employees: ${employees.length}`);
      console.log(`Directors/C-Suite: ${hierarchy.directors.length}`);
      console.log(`Managers: ${hierarchy.managers.length}`);
      console.log(`Supervisors: ${hierarchy.supervisors.length}`);
      console.log(`Team Leads: ${hierarchy.teamLeads.length}`);
      console.log(`Regular Employees: ${hierarchy.regular.length}`);
      console.log(`No Position Set: ${hierarchy.noPosition.length}`);

      // Show directors for this org
      if (hierarchy.directors.length > 0) {
        console.log('\nDirectors/Leadership:');
        hierarchy.directors.forEach(d => {
          console.log(`  - ${d.name} (${d.position}) [Level ${d.level}]`);
        });
      }

      // Find highest ranking person per department
      const deptHeads = {};
      const allWithPositions = [...hierarchy.directors, ...hierarchy.managers, ...hierarchy.supervisors, ...hierarchy.teamLeads];
      
      allWithPositions.forEach(emp => {
        if (!deptHeads[emp.department] || emp.level > deptHeads[emp.department].level) {
          deptHeads[emp.department] = emp;
        }
      });

      console.log('\nDepartment Heads (highest level per dept):');
      Object.entries(deptHeads).forEach(([dept, head]) => {
        console.log(`  ${dept}: ${head.name} (${head.position}) [Level ${head.level}]`);
      });
    }

    // 3. Find super admins for fallback
    console.log('\n3. SUPER ADMINS (Level 8) FOR FALLBACK:\n');
    const { data: superAdmins } = await supabase
      .from('thr_employees')
      .select('id, full_name, organization_id')
      .eq('access_level', 8);

    superAdmins.forEach(admin => {
      const org = orgMap[admin.organization_id];
      console.log(`- ${admin.full_name} (${org?.name || 'Unknown Org'})`);
    });

    // 4. Summary of who needs managers
    console.log('\n4. EMPLOYEES NEEDING MANAGER ASSIGNMENT:\n');
    const { count: needsManager } = await supabase
      .from('thr_employees')
      .select('*', { count: 'exact', head: true })
      .is('employment_info->>reporting_to', null);

    console.log(`Total needing managers: ${needsManager}`);

    // Show breakdown by organization
    console.log('\nBreakdown by organization:');
    for (const org of orgs) {
      const { count } = await supabase
        .from('thr_employees')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .is('employment_info->>reporting_to', null);
      
      if (count > 0) {
        console.log(`  ${org.name}: ${count} employees need managers`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

analyzeHierarchy();