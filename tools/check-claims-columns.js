const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Using correct THR database URL (ATLAS/THR shared)
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkClaimsColumns() {
  console.log('🔍 CTK: Checking thr_claims columns\n');
  console.log('='.repeat(60));

  try {
    // Get one claim to see all columns
    const { data: claims } = await supabase
      .from('thr_claims')
      .select('*')
      .limit(1);

    if (claims && claims[0]) {
      console.log('Available columns in thr_claims:');
      console.log('-'.repeat(40));
      
      const columns = Object.keys(claims[0]).sort();
      columns.forEach(col => {
        const value = claims[0][col];
        const type = typeof value;
        console.log(`  ${col}: ${type}${value === null ? ' (null)' : ''}`);
      });
      
      console.log('\n\nLooking for amount-related columns:');
      const amountColumns = columns.filter(col => 
        col.toLowerCase().includes('amount') || 
        col.toLowerCase().includes('total') ||
        col.toLowerCase().includes('value')
      );
      
      if (amountColumns.length > 0) {
        amountColumns.forEach(col => {
          console.log(`  - ${col}: ${claims[0][col]}`);
        });
      } else {
        console.log('  No amount-related columns found');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkClaimsColumns();