const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkTS001Claims() {
  console.log('🔍 CTK: Checking TS001 Claims\n');
  console.log('='.repeat(60));

  try {
    // 1. First find TS001's actual UUID (employee_id is in employment_info JSONB)
    console.log('1. Finding TS001 employee record:');
    const { data: employees, error: empError } = await supabase
      .from('thr_employees')
      .select('id, full_name, employment_info')
      .eq('employment_info->>employee_id', 'TS001');

    if (empError) {
      console.log('❌ Error finding TS001:', empError.message);
      
      // Try alternative approach
      console.log('\nTrying RPC function approach:');
      const { data: employee2 } = await supabase
        .rpc('get_employee_by_employee_id', { emp_id: 'TS001' });
      
      if (employee2 && employee2.length > 0) {
        employees = employee2;
      } else {
        // Last resort - check by name
        console.log('\nSearching by name:');
        const { data: byName } = await supabase
          .from('thr_employees')
          .select('id, full_name, employment_info')
          .ilike('full_name', '%neo%todak%');
        
        if (byName && byName.length > 0) {
          console.log('Found by name:', byName.map(e => `${e.full_name} (${e.employment_info?.employee_id})`).join(', '));
        }
        return;
      }
    }

    const employee = employees && employees[0];
    
    if (!employee) {
      console.log('❌ Employee TS001 not found');
      return;
    }

    console.log(`✅ Found: ${employee.full_name} (${employee.employment_info?.employee_id || 'No employee_id'})`);
    console.log(`   UUID: ${employee.id}`);

    // 2. Check claims for this employee
    console.log('\n2. Checking claims:');
    const { data: claims, error: claimError } = await supabase
      .from('thr_claims')
      .select(`
        id,
        claim_no,
        claim_type,
        claim_date,
        status,
        total_amount,
        receipts,
        receipt_urls,
        created_at
      `)
      .eq('employee_id', employee.id)  // Use UUID, not employee_id
      .order('created_at', { ascending: false });

    if (claimError) {
      console.log('❌ Error fetching claims:', claimError.message);
    } else if (!claims || claims.length === 0) {
      console.log('⚠️  No claims found');
    } else {
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
          console.log(`   - Receipts data: ${JSON.stringify(claim.receipts).substring(0, 100)}...`);
        }
        if (claim.receipt_urls) {
          console.log(`   - Receipt URLs: ${JSON.stringify(claim.receipt_urls).substring(0, 100)}...`);
        }
      });

      // 3. Check thr_claim_receipts for each claim
      console.log('\n3. Checking thr_claim_receipts table:');
      for (const claim of claims) {
        const { data: receipts, count } = await supabase
          .from('thr_claim_receipts')
          .select('*', { count: 'exact' })
          .eq('claim_id', claim.id);

        console.log(`   Claim ${claim.claim_no}: ${count || 0} receipt(s) in thr_claim_receipts`);
        
        if (receipts && receipts.length > 0) {
          receipts.forEach(r => {
            console.log(`     - ${r.file_name} (${r.file_path})`);
          });
        }
      }
    }

    // 4. Check storage bucket structure
    console.log('\n4. Checking claim-receipts storage bucket:');
    const { data: bucketFiles, error: bucketError } = await supabase
      .storage
      .from('claim-receipts')
      .list('', { limit: 100 });

    if (bucketError) {
      console.log('❌ Error:', bucketError.message);
    } else {
      console.log(`📁 Total files/folders: ${bucketFiles?.length || 0}`);
      
      // Check if there's a TS001 folder
      const ts001Folder = bucketFiles?.find(f => f.name === 'TS001' || f.name.includes('TS001'));
      if (ts001Folder) {
        console.log(`✅ Found TS001 folder: ${ts001Folder.name}`);
        
        // List files in TS001 folder
        const { data: ts001Files } = await supabase
          .storage
          .from('claim-receipts')
          .list('TS001', { limit: 100 });
          
        if (ts001Files && ts001Files.length > 0) {
          console.log(`   Files in TS001 folder: ${ts001Files.length}`);
          ts001Files.forEach(f => {
            console.log(`   - ${f.name}`);
          });
        }
      }
      
      // Also check for UUID-based folders
      const uuidFolder = bucketFiles?.find(f => f.name === employee.id);
      if (uuidFolder) {
        console.log(`✅ Found UUID folder: ${uuidFolder.name}`);
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkTS001Claims();