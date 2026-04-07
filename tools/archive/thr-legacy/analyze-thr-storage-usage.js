const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use correct THR database
const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeTHRStorageUsage() {
  console.log('=== THR Storage Usage Analysis ===\n');
  
  try {
    // Check claim receipts table
    console.log('1. Checking thr_claim_receipts table...');
    const { data: claimReceiptsSchema, error: schemaError } = await supabase
      .from('thr_claim_receipts')
      .select('*')
      .limit(1);
      
    if (!schemaError) {
      console.log('✅ thr_claim_receipts table exists');
      
      // Get sample data
      const { data: sampleReceipts, count } = await supabase
        .from('thr_claim_receipts')
        .select('*', { count: 'exact' })
        .limit(5);
        
      console.log(`   Total receipts: ${count}`);
      if (sampleReceipts && sampleReceipts.length > 0) {
        console.log('   Sample receipt structure:');
        console.log('   - file_path:', sampleReceipts[0].file_path?.substring(0, 50) + '...');
        console.log('   - file_name:', sampleReceipts[0].file_name);
        console.log('   - Bucket used: claim-receipts');
      }
    } else {
      console.log('❌ thr_claim_receipts table not found or error:', schemaError.message);
    }
    
    // Check thr_documents table
    console.log('\n2. Checking thr_documents table...');
    const { data: documentsSchema, error: docError } = await supabase
      .from('thr_documents')
      .select('*')
      .limit(1);
      
    if (!docError) {
      console.log('✅ thr_documents table exists');
      
      const { data: sampleDocs, count: docCount } = await supabase
        .from('thr_documents')
        .select('*', { count: 'exact' })
        .limit(5);
        
      console.log(`   Total documents: ${docCount}`);
      if (sampleDocs && sampleDocs.length > 0) {
        console.log('   Sample document:');
        console.log('   - storage_path:', sampleDocs[0].storage_path);
        console.log('   - document_type:', sampleDocs[0].document_type);
        console.log('   - Bucket used: employee-documents');
      }
    } else {
      console.log('❌ thr_documents table not found');
    }
    
    // Check employee-documents bucket contents
    console.log('\n3. Checking employee-documents bucket contents...');
    const { data: bucketContents, error: bucketError } = await supabase.storage
      .from('employee-documents')
      .list('', { limit: 10 });
      
    if (!bucketError && bucketContents) {
      console.log(`   Files in employee-documents: ${bucketContents.length}`);
      
      // Look for claim folder
      const { data: claimFolder } = await supabase.storage
        .from('employee-documents')
        .list('claim', { limit: 5 });
        
      if (claimFolder && claimFolder.length > 0) {
        console.log('   ✅ Found "claim" folder in employee-documents!');
        console.log(`   Files in claim folder: ${claimFolder.length}`);
        claimFolder.forEach(file => {
          console.log(`   - ${file.name}`);
        });
      }
    }
    
    console.log('\n📊 Analysis Summary:');
    console.log('- Claims are using: claim-receipts bucket');
    console.log('- Documents system uses: employee-documents bucket');
    console.log('- Both systems store files differently');
    console.log('\n🤔 Question: Why not use employee-documents for everything?');
    console.log('Possible reasons:');
    console.log('1. Separation of concerns - claims vs general documents');
    console.log('2. Different access patterns - claims might be public, documents private');
    console.log('3. Historical development - claims system might have been built first');
    console.log('4. Storage organization - easier to manage/backup separately');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

analyzeTHRStorageUsage();