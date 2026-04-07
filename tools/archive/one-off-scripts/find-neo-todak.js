const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function findNeoTodak() {
  console.log('🔍 CTK: Finding Neo Todak\n');
  console.log('='.repeat(60));

  try {
    // 1. Search by name
    console.log('1. Searching by name:');
    const { data: byName, error: nameError } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info, contact_info')
      .or('full_name.ilike.%neo%,full_name.ilike.%todak%')
      .limit(10);

    if (nameError) {
      console.log('❌ Error:', nameError.message);
    } else if (byName && byName.length > 0) {
      console.log(`✅ Found ${byName.length} matches:`);
      byName.forEach(emp => {
        console.log(`\n   Name: ${emp.full_name}`);
        console.log(`   UUID: ${emp.id}`);
        console.log(`   Employee ID: ${emp.employment_info?.employee_id || 'Not set'}`);
        console.log(`   Department: ${emp.employment_info?.department || 'Not set'}`);
        console.log(`   Company Email: ${emp.contact_info?.emails?.company || 'Not set'}`);
      });
    } else {
      console.log('⚠️  No employees found with "neo" or "todak" in name');
    }

    // 2. Check if we have TS001 in employment_info
    console.log('\n2. Looking for TS001 specifically:');
    const { data: allEmployees, error: allError } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info')
      .limit(500);

    if (!allError && allEmployees) {
      const ts001 = allEmployees.find(emp => 
        emp.employment_info?.employee_id === 'TS001' ||
        emp.employment_info?.staff_id === 'TS001'
      );
      
      if (ts001) {
        console.log('✅ Found TS001!');
        console.log(`   Name: ${ts001.full_name}`);
        console.log(`   UUID: ${ts001.id}`);
        console.log(`   Employee ID: ${ts001.employment_info?.employee_id || ts001.employment_info?.staff_id}`);
      } else {
        console.log('⚠️  TS001 not found in employment_info');
        
        // Show sample employee IDs
        const sampleIds = allEmployees
          .filter(e => e.employment_info?.employee_id || e.employment_info?.staff_id)
          .slice(0, 5)
          .map(e => e.employment_info?.employee_id || e.employment_info?.staff_id);
        
        console.log('\nSample employee IDs found:', sampleIds.join(', '));
      }
    }

    // 3. Check CEO specifically
    console.log('\n3. Looking for CEO:');
    const { data: ceo } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info')
      .eq('employment_info->>designation', 'CHIEF EXECUTIVE OFFICER')
      .single();

    if (ceo) {
      console.log('✅ Found CEO:');
      console.log(`   Name: ${ceo.full_name}`);
      console.log(`   UUID: ${ceo.id}`);
      console.log(`   Employee ID: ${ceo.employment_info?.employee_id || ceo.employment_info?.staff_id || 'Not set'}`);
      
      // Now check claims for CEO
      console.log('\n4. Checking CEO claims:');
      const { data: claims } = await supabase
        .from('thr_claims')
        .select('*')
        .eq('employee_id', ceo.id)
        .order('created_at', { ascending: false });

      if (claims && claims.length > 0) {
        console.log(`✅ Found ${claims.length} claim(s) for CEO`);
        claims.forEach(claim => {
          console.log(`\n   Claim: ${claim.claim_no}`);
          console.log(`   - Type: ${claim.claim_type}`);
          console.log(`   - Status: ${claim.status}`);
          console.log(`   - Has receipts: ${claim.receipts ? 'Yes' : 'No'}`);
          console.log(`   - Has receipt_urls: ${claim.receipt_urls ? 'Yes' : 'No'}`);
        });
      } else {
        console.log('⚠️  No claims found for CEO');
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

findNeoTodak();