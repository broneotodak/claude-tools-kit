const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function investigate() {
  const empId = 'f221e445-ac90-4417-852b-ab76d792bd0c';
  const orgId = '7c154cd5-4773-4f27-a136-e60ab2bfe0a2';

  // First, check the actual column names in thr_leave_entitlements
  console.log('=== Entitlement Table Columns ===\n');
  const { data: sample } = await supabase
    .from('thr_leave_entitlements')
    .select('*')
    .limit(1);

  if (sample && sample[0]) {
    console.log('Columns:', Object.keys(sample[0]).join(', '));
  }

  // Get entitlements with ALL columns visible
  console.log('\n=== AL Entitlements (raw) ===\n');
  const { data: ents } = await supabase
    .from('thr_leave_entitlements')
    .select('*, thr_leave_types!inner(code, name)')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .eq('thr_leave_types.code', 'AL');

  console.log('AL entitlements found:', ents?.length);
  ents?.forEach((e, i) => {
    console.log('\n--- Entitlement', i+1, '---');
    console.log('days_entitled:', e.days_entitled);
    console.log('staff_category_code:', e.staff_category_code);
    console.log('employment_type_id:', e.employment_type_id);
    console.log('min_service_months:', e.min_service_months);
    console.log('years_service_min:', e.years_service_min);
    console.log('years_service_max:', e.years_service_max);
  });

  // Check employee's employment_type_id
  console.log('\n\n=== Employee Details ===\n');
  const { data: emp } = await supabase
    .from('thr_employees')
    .select('id, full_name, employment_info')
    .eq('id', empId)
    .single();

  console.log('Name:', emp?.full_name);
  console.log('employment_type_id (for matching):', emp?.employment_info?.employment_type_id);
  console.log('staff_category (for matching):', emp?.employment_info?.staff_category?.toUpperCase());
  console.log('employment_type:', emp?.employment_info?.employment_type);
  console.log('Tenure Years:', emp?.employment_info?.tenure_years);

  // Simulate the FIXED matching logic
  console.log('\n\n=== Simulating FIXED findBestEntitlementMatch ===\n');
  const employmentTypeId = emp?.employment_info?.employment_type_id;
  const staffCategoryCode = emp?.employment_info?.staff_category?.toUpperCase();

  console.log('Looking for:');
  console.log('  employmentTypeId:', employmentTypeId);
  console.log('  staffCategoryCode:', staffCategoryCode);

  let bestMatch = null;
  let bestScore = -1;

  ents?.forEach((ent, i) => {
    let score = 0;

    const empTypeMatch = ent.employment_type_id === employmentTypeId;
    const empTypeIsNull = ent.employment_type_id === null;
    const staffCatMatch = ent.staff_category_code === staffCategoryCode;
    const staffCatIsNull = ent.staff_category_code === null;

    // FIX: Handle case where employee's employmentTypeId is undefined
    const empTypeUndefined = employmentTypeId === undefined || employmentTypeId === null;

    if (empTypeMatch && staffCatMatch) score = 4;
    else if (empTypeMatch && staffCatIsNull) score = 3;
    else if (empTypeIsNull && staffCatMatch) score = 2;
    else if (empTypeUndefined && staffCatMatch) score = 2;  // NEW: Staff cat match when emp type unknown
    else if (empTypeIsNull && staffCatIsNull) score = 1;
    else if (empTypeUndefined && staffCatIsNull) score = 1;  // NEW: Default when emp type unknown

    console.log('Ent', i+1, ':', ent.days_entitled, 'days | score:', score,
      '| empTypeMatch:', empTypeMatch,
      '| staffCatMatch:', staffCatMatch,
      '| empTypeUndefined:', empTypeUndefined);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = ent;
    }
  });

  console.log('\n==> FIXED Best match:', bestMatch?.days_entitled, 'days (score:', bestScore + ')');
  console.log('==> Expected for CEO category: 21 or 18 days (depending on employment type)');

  // Current balances
  console.log('\n\n=== Current Leave Balances ===\n');
  const { data: balances } = await supabase
    .from('thr_leave_balances')
    .select('*')
    .eq('employee_id', empId)
    .in('year', [2025, 2026])
    .order('year');

  console.log('Year | Leave Type | Entitled | Taken | Balance');
  console.log('-'.repeat(60));
  balances?.forEach(b => {
    console.log(b.year + ' | ' + b.leave_type.padEnd(15) + ' | ' +
      String(b.entitlement).padStart(3) + ' | ' +
      String(b.taken).padStart(3) + ' | ' +
      String(b.balance).padStart(3));
  });
}

investigate().catch(console.error);
