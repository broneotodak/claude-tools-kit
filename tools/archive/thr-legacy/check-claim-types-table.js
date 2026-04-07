const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkClaimTypes() {
  console.log('🔍 CTK: Checking Claim Types\n');
  console.log('='.repeat(60));

  try {
    // 1. Check if thr_claim_types table exists
    console.log('1. Checking thr_claim_types table:');
    const { data: types, error: typesError } = await supabase
      .from('thr_claim_types')
      .select('*')
      .limit(5);

    if (typesError) {
      console.log('❌ Error:', typesError.message);
      
      // Check alternative table names
      console.log('\n2. Checking alternative table names:');
      const { data: items } = await supabase
        .from('thr_claim_items')
        .select('*')
        .limit(5);
      
      if (items) {
        console.log('✅ Found thr_claim_items table');
        console.log('Items:', items.map(i => i.name || i.item_name || JSON.stringify(i)).join(', '));
      }
    } else {
      console.log('✅ thr_claim_types exists');
      console.log('Types:', types.map(t => t.name).join(', '));
    }

    // 2. Check thr_claims structure
    console.log('\n3. Checking thr_claims structure:');
    const { data: claims } = await supabase
      .from('thr_claims')
      .select('*')
      .limit(1);

    if (claims && claims[0]) {
      console.log('Sample claim columns:', Object.keys(claims[0]).join(', '));
      
      if (claims[0].claim_type) {
        console.log('claim_type value:', claims[0].claim_type);
      }
      if (claims[0].claim_type_id) {
        console.log('claim_type_id value:', claims[0].claim_type_id);
      }
      if (claims[0].receipt_urls) {
        console.log('receipt_urls:', claims[0].receipt_urls);
      }
      if (claims[0].receipt_url) {
        console.log('receipt_url:', claims[0].receipt_url);
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkClaimTypes();