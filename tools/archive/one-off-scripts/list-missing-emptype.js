const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });
const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

async function analyze() {
  const orgId = '7c154cd5-4773-4f27-a136-e60ab2bfe0a2';

  const { data: emps } = await supabase
    .from('thr_employees')
    .select('employee_no, full_name, employment_info, data_source')
    .eq('organization_id', orgId)
    .eq('employment_info->>employment_status', 'active')
    .eq('data_source', 'master_hr2000')
    .order('employee_no');

  console.log('=== All master_hr2000 employees analysis ===\n');
  console.log('Total:', emps?.length);

  // Categorize using explicit checks
  const hasTypeId = emps?.filter(e => e.employment_info?.employment_type_id) || [];
  const hasTypeString = emps?.filter(e => e.employment_info?.employment_type) || [];
  const hasBoth = emps?.filter(e => e.employment_info?.employment_type_id && e.employment_info?.employment_type) || [];
  const hasStringOnly = emps?.filter(e => e.employment_info?.employment_type && e.employment_info?.employment_type_id === undefined) || [];
  const hasIdOnly = emps?.filter(e => e.employment_info?.employment_type_id && e.employment_info?.employment_type === undefined) || [];
  const hasNeither = emps?.filter(e => e.employment_info?.employment_type_id === undefined && e.employment_info?.employment_type === undefined) || [];

  console.log('\nBreakdown:');
  console.log('  Has employment_type_id:', hasTypeId.length);
  console.log('  Has employment_type (string):', hasTypeString.length);
  console.log('  Has BOTH:', hasBoth.length);
  console.log('  Has STRING only (missing ID):', hasStringOnly.length, '← These 11 have the issue');
  console.log('  Has ID only (no string):', hasIdOnly.length);
  console.log('  Has NEITHER:', hasNeither.length);

  // Show the ones with ID only
  if (hasIdOnly.length > 0) {
    console.log('\n=== Employees with ID but no string ===');
    hasIdOnly.slice(0,5).forEach(e => {
      console.log('  -', e.employee_no, '| type_id:', e.employment_info?.employment_type_id);
    });
  }

  // Show ones with neither
  if (hasNeither.length > 0) {
    console.log('\n=== Employees with NEITHER (no employment type info) ===');
    hasNeither.slice(0,10).forEach(e => {
      console.log('  -', e.employee_no, '|', e.full_name);
    });
  }

  // Compare with those with BOTH
  if (hasBoth.length > 0) {
    console.log('\n=== Employees with BOTH (correctly set) ===');
    hasBoth.slice(0,5).forEach(e => {
      console.log('  -', e.employee_no, '| type:', e.employment_info?.employment_type, '| id:', e.employment_info?.employment_type_id?.substring(0,8) + '...');
    });
  }

  // The 11 with string only
  console.log('\n=== The 11 with STRING only (the issue) ===');
  hasStringOnly.forEach(e => {
    console.log('  -', e.employee_no, '|', e.full_name.substring(0,30), '| type:', e.employment_info?.employment_type);
  });
}

analyze().catch(console.error);
