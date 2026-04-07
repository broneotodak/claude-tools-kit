const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkClaimOwner() {
  console.log('🔍 CTK: Checking Claim Owner\n');
  console.log('='.repeat(60));

  try {
    // 1. Get the employee with claims
    const employeeId = 'f221e445-28f8-4e76-933f-b036c860fa70'; // From previous output
    
    console.log('1. Finding employee with claims:');
    const { data: employee } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info, contact_info')
      .eq('id', employeeId)
      .single();

    if (employee) {
      console.log(`✅ Found: ${employee.full_name}`);
      console.log(`   UUID: ${employee.id}`);
      console.log(`   Employee ID: ${employee.employment_info?.employee_id || 'Not set'}`);
      console.log(`   Department: ${employee.employment_info?.department || 'Not set'}`);
      console.log(`   Designation: ${employee.employment_info?.designation || 'Not set'}`);
      
      // 2. Check their claims in detail
      console.log('\n2. Checking claims:');
      const { data: claims } = await supabase
        .from('thr_claims')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });

      if (claims && claims.length > 0) {
        console.log(`✅ Found ${claims.length} claim(s):`);
        claims.forEach(claim => {
          console.log(`\n   Claim: ${claim.claim_no}`);
          console.log(`   - Type: ${claim.claim_type}`);
          console.log(`   - Status: ${claim.status}`);
          console.log(`   - Amount: RM ${claim.total_amount}`);
          console.log(`   - Date: ${new Date(claim.claim_date).toLocaleDateString()}`);
          console.log(`   - Has receipts field: ${claim.receipts ? 'Yes' : 'No'}`);
          console.log(`   - Has receipt_urls: ${claim.receipt_urls ? 'Yes' : 'No'}`);
          
          if (claim.receipts) {
            console.log(`   - Receipts data:`, claim.receipts);
          }
          if (claim.receipt_urls) {
            console.log(`   - Receipt URLs:`, claim.receipt_urls);
          }
        });
      }
      
      // 3. Check storage paths
      console.log('\n3. Checking claim-receipts bucket for this employee:');
      
      // Check by employee_id if exists
      if (employee.employment_info?.employee_id) {
        const { data: files1 } = await supabase
          .storage
          .from('claim-receipts')
          .list(employee.employment_info.employee_id, { limit: 100 });
          
        if (files1 && files1.length > 0) {
          console.log(`✅ Found files in ${employee.employment_info.employee_id} folder:`, files1.length);
        }
      }
      
      // Check by UUID
      const { data: files2 } = await supabase
        .storage
        .from('claim-receipts')
        .list(employee.id, { limit: 100 });
        
      if (files2 && files2.length > 0) {
        console.log(`✅ Found files in ${employee.id} folder:`, files2.length);
      }
      
      // Check root level
      const { data: rootFiles } = await supabase
        .storage
        .from('claim-receipts')
        .list('', { limit: 100 });
        
      console.log(`\nRoot level items in claim-receipts:`, rootFiles?.map(f => f.name).join(', '));
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkClaimOwner();