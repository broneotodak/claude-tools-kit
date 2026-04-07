const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
require('dotenv').config({ path: '.env.thr', override: true });

// Use THR Supabase credentials
const supabase = createClient(
  'https://aiazdgohytygipiddbtp.supabase.co',
  process.env.THR_SERVICE_KEY
);

async function checkTHRStorageBuckets() {
  console.log('=== THR Storage Buckets Check ===');
  console.log('Supabase URL: https://aiazdgohytygipiddbtp.supabase.co\n');
  
  try {
    // Get list of buckets
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      console.error('Error fetching buckets:', bucketsError);
      console.log('\nNote: Make sure you have the THR service role key in your .env');
      return;
    }
    
    console.log('📦 Existing Buckets in THR Supabase:');
    const bucketMap = {};
    buckets.forEach(bucket => {
      console.log(`- ${bucket.name} (${bucket.public ? 'Public' : 'Private'})`);
      bucketMap[bucket.name] = bucket;
    });
    
    // Check against required buckets from code
    console.log('\n✅ Required Buckets (from THR code analysis):');
    const requiredBuckets = [
      { name: 'employee-photos', usage: 'Profile photos' },
      { name: 'employee-documents', usage: 'Document management system' },
      { name: 'claim-receipts', usage: 'Claim receipt uploads' },
      { name: 'memos', usage: 'Memo attachments (SQL script 101)' }
    ];
    
    const missingBuckets = [];
    requiredBuckets.forEach(req => {
      const exists = bucketMap[req.name];
      if (exists) {
        console.log(`✓ ${req.name} - ${req.usage} (${exists.public ? 'Public' : 'Private'})`);
      } else {
        console.log(`✗ ${req.name} - ${req.usage} [MISSING]`);
        missingBuckets.push(req);
      }
    });
    
    // Check for thr-documents (mentioned in SQL but not used in code)
    if (bucketMap['thr-documents']) {
      console.log('\n⚠️  Note: "thr-documents" bucket exists but code uses "employee-documents"');
    }
    
    // Summary
    if (missingBuckets.length > 0) {
      console.log('\n❌ Missing Buckets:');
      missingBuckets.forEach(bucket => {
        console.log(`- ${bucket.name}: ${bucket.usage}`);
      });
      
      console.log('\n📝 To create missing buckets:');
      console.log('1. Go to THR Supabase Dashboard: https://supabase.com/dashboard/project/aiazdgohytygipiddbtp/storage/buckets');
      console.log('2. Click "New bucket" for each missing bucket');
      console.log('3. Set appropriate public/private settings:');
      console.log('   - employee-photos: Public (for profile display)');
      console.log('   - employee-documents: Private (sensitive docs)');
      console.log('   - claim-receipts: Private (financial docs)');
      console.log('   - memos: Private (internal communications)');
    } else {
      console.log('\n✅ All required buckets exist!');
    }
    
    // Test accessibility
    console.log('\n🔍 Testing Bucket Accessibility:');
    for (const req of requiredBuckets) {
      if (bucketMap[req.name]) {
        try {
          const { data, error } = await supabase.storage
            .from(req.name)
            .list('', { limit: 1 });
          
          if (error) {
            console.log(`  ${req.name}: ❌ Access Error - ${error.message}`);
          } else {
            console.log(`  ${req.name}: ✅ Accessible`);
          }
        } catch (err) {
          console.log(`  ${req.name}: ❌ Error - ${err.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
    console.log('\nMake sure you have the correct THR service role key');
  }
}

checkTHRStorageBuckets();