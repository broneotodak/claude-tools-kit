const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkClaimReceipts() {
  console.log('🔍 CTK: Checking THR Claim Receipts Data\n');
  console.log('Database: ftbtsxlujsnobujwekwx.supabase.co (ATLAS/THR shared)');
  console.log('='.repeat(60));

  try {
    // 1. Check if thr_claim_receipts table exists
    console.log('\n1. Checking thr_claim_receipts table:');
    const { data: tableExists, error: tableError } = await supabase
      .from('thr_claim_receipts')
      .select('*')
      .limit(1);

    if (tableError) {
      console.log('❌ Table error:', tableError.message);
      if (tableError.message.includes('relation') && tableError.message.includes('does not exist')) {
        console.log('⚠️  Table thr_claim_receipts does not exist!');
        return;
      }
    } else {
      console.log('✅ Table exists');
    }

    // 2. Count total receipts
    const { count: totalCount } = await supabase
      .from('thr_claim_receipts')
      .select('*', { count: 'exact', head: true });
    console.log(`📊 Total receipts: ${totalCount || 0}`);

    // 3. Check TS001's claim receipts
    console.log('\n2. Checking TS001 claim receipts:');
    const { data: ts001Claims, error: claimError } = await supabase
      .from('thr_claims')
      .select('id, claim_no, claim_type, status, created_at')
      .eq('employee_id', 'TS001')
      .order('created_at', { ascending: false });

    if (claimError) {
      console.log('❌ Error fetching claims:', claimError.message);
    } else if (!ts001Claims || ts001Claims.length === 0) {
      console.log('⚠️  No claims found for TS001');
    } else {
      console.log(`✅ Found ${ts001Claims.length} claim(s) for TS001:`);
      ts001Claims.forEach(claim => {
        console.log(`   - Claim ${claim.claim_no} (${claim.claim_type}) - Status: ${claim.status}`);
      });

      // Check receipts for each claim
      for (const claim of ts001Claims) {
        const { data: receipts, count } = await supabase
          .from('thr_claim_receipts')
          .select('*', { count: 'exact' })
          .eq('claim_id', claim.id);

        console.log(`     → ${count || 0} receipt(s) in thr_claim_receipts`);
      }
    }

    // 4. Check claim-receipts storage bucket
    console.log('\n3. Checking claim-receipts storage bucket:');
    const { data: bucketFiles, error: bucketError } = await supabase
      .storage
      .from('claim-receipts')
      .list('', { limit: 100 });

    if (bucketError) {
      console.log('❌ Error accessing bucket:', bucketError.message);
    } else {
      console.log(`📁 Files in claim-receipts bucket: ${bucketFiles?.length || 0}`);
      if (bucketFiles && bucketFiles.length > 0) {
        console.log('Files:');
        bucketFiles.slice(0, 5).forEach(file => {
          console.log(`   - ${file.name} (${(file.metadata?.size / 1024).toFixed(2)} KB)`);
        });
        if (bucketFiles.length > 5) {
          console.log(`   ... and ${bucketFiles.length - 5} more`);
        }
      }
    }

    // 5. Alternative: Check if receipts are stored directly in claims table
    console.log('\n4. Checking if receipts stored in thr_claims table:');
    const { data: claimsWithReceipts } = await supabase
      .from('thr_claims')
      .select('claim_no, receipt_urls, receipts')
      .eq('employee_id', 'TS001')
      .not('receipt_urls', 'is', null);

    if (claimsWithReceipts && claimsWithReceipts.length > 0) {
      console.log('✅ Found claims with receipt_urls:');
      claimsWithReceipts.forEach(claim => {
        console.log(`   - ${claim.claim_no}: ${claim.receipt_urls ? 'Has URLs' : 'No URLs'}`);
      });
    } else {
      console.log('⚠️  No receipt_urls found in claims table');
    }

    // 6. Check DocumentList query
    console.log('\n5. Testing DocumentList query:');
    const testQuery = await supabase
      .from('thr_claims')
      .select(`
        id,
        claim_no,
        claim_type,
        claim_date,
        status,
        total_amount
      `)
      .eq('employee_id', 'TS001')
      .order('created_at', { ascending: false });

    console.log('Query result:', testQuery.data ? `${testQuery.data.length} claims found` : 'No data');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkClaimReceipts();