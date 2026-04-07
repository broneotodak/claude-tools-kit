const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function investigate() {
  console.log('=== Investigating neo@todak.com Leave Balance Issue ===\n');

  // 1. Find the employee by searching contact_info
  console.log('1. Finding employee record...');
  const { data: allEmps } = await supabase
    .from('thr_employees')
    .select(`
      id,
      employee_no,
      full_name,
      organization_id,
      staff_category_id,
      employment_info,
      contact_info,
      auth_user_id
    `)
    .eq('employment_info->>employment_status', 'active');

  const neo = allEmps?.find(e => {
    const contactStr = JSON.stringify(e.contact_info || {}).toLowerCase();
    return contactStr.includes('neo@todak');
  });

  if (!neo) {
    console.log('ERROR: Employee with neo@todak.com not found!');
    return;
  }

  console.log('Found:', neo.full_name);
  console.log('Employee No:', neo.employee_no);
  console.log('Employee ID:', neo.id);
  console.log('Organization ID:', neo.organization_id);
  console.log('Staff Category ID:', neo.staff_category_id);
  console.log('Employment Type:', neo.employment_info?.employment_type);
  console.log('Employment Status:', neo.employment_info?.employment_status);
  console.log('Join Date:', neo.employment_info?.join_date);

  // 2. Get the staff category details
  console.log('\n2. Checking staff category...');
  if (neo.staff_category_id) {
    const { data: category } = await supabase
      .from('thr_staff_categories')
      .select('*')
      .eq('id', neo.staff_category_id)
      .single();

    if (category) {
      console.log('Staff Category:', category.name);
      console.log('Category Level:', category.level_hierarchy);
    } else {
      console.log('WARNING: Staff category not found for ID:', neo.staff_category_id);
    }
  } else {
    console.log('WARNING: No staff_category_id set for this employee!');
  }

  // 3. Get the organization's leave entitlements
  console.log('\n3. Checking leave entitlements for organization...');
  const { data: entitlements } = await supabase
    .from('thr_leave_entitlements')
    .select(`
      *,
      thr_staff_categories(name),
      thr_employment_types(name),
      thr_leave_types(name, code)
    `)
    .eq('organization_id', neo.organization_id)
    .eq('is_active', true);

  console.log('Total entitlements configured:', entitlements?.length || 0);

  // Group by staff category
  const byCategory = {};
  entitlements?.forEach(e => {
    const catName = e.thr_staff_categories?.name || 'Unknown';
    if (!byCategory[catName]) byCategory[catName] = [];
    byCategory[catName].push({
      leaveType: e.thr_leave_types?.name || e.leave_type_id,
      days: e.days_entitled,
      employmentType: e.thr_employment_types?.name || 'All'
    });
  });

  console.log('\nEntitlements by Staff Category:');
  Object.entries(byCategory).forEach(([cat, ents]) => {
    console.log(`\n  ${cat}:`);
    ents.forEach(e => {
      console.log(`    - ${e.leaveType}: ${e.days} days (${e.employmentType})`);
    });
  });

  // 4. Check the employee's current leave balance
  console.log('\n4. Checking leave balance for 2025 and 2026...');
  const { data: balances } = await supabase
    .from('thr_leave_balances')
    .select('*')
    .eq('employee_id', neo.id)
    .in('year', [2025, 2026])
    .order('year');

  if (!balances || balances.length === 0) {
    console.log('No leave balances found!');
  } else {
    console.log('Leave Balances:');
    balances.forEach(b => {
      console.log(`  ${b.year} - ${b.leave_type}: Entitled=${b.entitlement}, Taken=${b.taken}, Balance=${b.balance}`);
    });
  }

  // 5. Check what the initialization logic would calculate
  console.log('\n5. Analyzing what entitlement SHOULD apply...');
  const empType = neo.employment_info?.employment_type;
  const staffCatId = neo.staff_category_id;

  console.log('Employee employment_type:', empType);
  console.log('Employee staff_category_id:', staffCatId);

  // Find matching entitlement
  const matchingEntitlement = entitlements?.find(e => {
    const matchesCat = e.staff_category_id === staffCatId;
    const matchesEmpType = !e.employment_type_id || e.employment_type_id === empType;
    return matchesCat && matchesEmpType;
  });

  if (matchingEntitlement) {
    console.log('\nMatching entitlement found:');
    console.log('  Leave Type:', matchingEntitlement.thr_leave_types?.name);
    console.log('  Days Entitled:', matchingEntitlement.days_entitled);
    console.log('  Staff Category:', matchingEntitlement.thr_staff_categories?.name);
  } else {
    console.log('\nWARNING: No matching entitlement found for this employee!');
    console.log('This could be because:');
    console.log('  - staff_category_id is not set or invalid');
    console.log('  - No entitlement configured for this staff category');
    console.log('  - employment_type mismatch');
  }

  // 6. List all staff categories for this org
  console.log('\n6. All staff categories for this organization:');
  const { data: orgCategories } = await supabase
    .from('thr_staff_categories')
    .select('id, name, level_hierarchy')
    .eq('organization_id', neo.organization_id)
    .eq('is_active', true)
    .order('level_hierarchy');

  orgCategories?.forEach(c => {
    const isMatch = c.id === staffCatId ? ' <-- EMPLOYEE\'S CATEGORY' : '';
    console.log(`  ${c.level_hierarchy}. ${c.name} (ID: ${c.id})${isMatch}`);
  });
}

investigate().catch(console.error);
