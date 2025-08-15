const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkReceiptFields() {
  console.log('🔍 CTK: Checking Receipt Fields\n');
  console.log('='.repeat(60));

  try {
    // Get all claims
    const { data: claims, error } = await supabase
      .from('thr_claims')
      .select('*')
      .limit(10);

    if (error) {
      console.log('Error:', error);
      return;
    }

    if (claims && claims.length > 0) {
      console.log(`Found ${claims.length} claims:\n`);
      
      for (const claim of claims) {
        // Get employee info
        const { data: employee } = await supabase
          .from('thr_employees')
          .select('full_name, employment_info')
          .eq('id', claim.employee_id)
          .single();
        
        console.log(`Claim ${claim.claim_no}:`);
        console.log(`  - Employee: ${employee?.full_name} (${employee?.employment_info?.employee_id || 'No emp ID'})`);
        console.log(`  - Employee UUID: ${claim.employee_id}`);
        if (claim.receipt_url) {
          console.log(`  - receipt_url: ${typeof claim.receipt_url} - ${claim.receipt_url?.substring(0, 60)}...`);
        }
        if (claim.receipt_urls) {
          console.log(`  - receipt_urls: ${typeof claim.receipt_urls} - ${JSON.stringify(claim.receipt_urls)?.substring(0, 60)}...`);
        }
        console.log('');
      }
    } else {
      console.log('No claims found with receipts');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkReceiptFields();