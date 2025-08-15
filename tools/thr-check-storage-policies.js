const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStoragePolicies() {
  console.log('=== THR Storage Buckets and Policies Check ===\n');
  
  try {
    // Check existing buckets
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      console.error('Error fetching buckets:', bucketsError);
      return;
    }
    
    console.log('📦 Existing Buckets:');
    buckets.forEach(bucket => {
      console.log(`- ${bucket.name} (${bucket.public ? 'Public' : 'Private'})`);
    });
    
    // THR required buckets based on code analysis
    const requiredBuckets = [
      'employee-photos',      // Used in TestPhotoUpload.jsx
      'employee-documents',   // Used in documentService.js and employeeDocumentService.js
      'claim-receipts',      // Used in ClaimForm.tsx
      'memos'               // Required by SQL script 101
    ];
    
    console.log('\n✅ THR Required Buckets (based on code):');
    requiredBuckets.forEach(bucketName => {
      const exists = buckets.some(b => b.name === bucketName);
      console.log(`- ${bucketName}: ${exists ? '✓ EXISTS' : '✗ MISSING'}`);
    });
    
    // Check storage policies
    console.log('\n📋 Storage Policies:');
    
    const { data: policies, error: policiesError } = await supabase.rpc('get_policies_for_table', {
      schema_name: 'storage',
      table_name: 'objects'
    }).catch(async () => {
      // Fallback if RPC doesn't exist
      const { data, error } = await supabase
        .from('pg_policies')
        .select('*')
        .eq('schemaname', 'storage')
        .eq('tablename', 'objects');
      return { data, error };
    });
    
    if (policies && policies.length > 0) {
      const bucketPolicies = {};
      
      policies.forEach(policy => {
        // Extract bucket name from policy definition if possible
        const bucketMatch = policy.definition?.match(/bucket_id = '([^']+)'/);
        const bucketName = bucketMatch ? bucketMatch[1] : 'unknown';
        
        if (!bucketPolicies[bucketName]) {
          bucketPolicies[bucketName] = [];
        }
        
        bucketPolicies[bucketName].push({
          name: policy.policyname,
          cmd: policy.cmd,
          permissive: policy.permissive
        });
      });
      
      Object.entries(bucketPolicies).forEach(([bucket, pols]) => {
        console.log(`\n  Bucket: ${bucket}`);
        pols.forEach(pol => {
          console.log(`    - ${pol.name} (${pol.cmd})`);
        });
      });
    } else {
      console.log('  Unable to fetch policies directly. Checking alternative method...');
      
      // Try another approach
      const { data: allPolicies, error: allPoliciesError } = await supabase.rpc('get_storage_policies').catch(() => ({ data: null, error: 'RPC not available' }));
      
      if (allPolicies) {
        console.log('  Found policies via RPC');
      } else {
        console.log('  ⚠️  Cannot retrieve policies - need to check in Supabase Dashboard');
      }
    }
    
    // Test bucket accessibility
    console.log('\n🔍 Testing Bucket Accessibility:');
    
    for (const bucketName of requiredBuckets) {
      if (buckets.some(b => b.name === bucketName)) {
        try {
          const { data, error } = await supabase.storage
            .from(bucketName)
            .list('', { limit: 1 });
          
          if (error) {
            console.log(`  ${bucketName}: ❌ Access Error - ${error.message}`);
          } else {
            console.log(`  ${bucketName}: ✅ Accessible`);
          }
        } catch (err) {
          console.log(`  ${bucketName}: ❌ Error - ${err.message}`);
        }
      } else {
        console.log(`  ${bucketName}: ⚠️  Bucket does not exist`);
      }
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log('THR uses these buckets in the code:');
    console.log('1. employee-photos - For profile photos');
    console.log('2. employee-documents - For document management system');
    console.log('3. claim-receipts - For claim receipt uploads');
    console.log('4. memos - For memo attachments (per SQL)');
    console.log('\nNote: The SQL mentions "thr-documents" but the actual code uses "employee-documents"');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkStoragePolicies();