#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function verifyStorageSetup() {
    console.log('🔍 Verifying THR Storage Setup...\n');
    
    // 1. Check if tables were created
    console.log('📋 Checking database tables...');
    const tables = [
        'thr_employee_photos',
        'thr_employee_documents', 
        'thr_document_types'
    ];
    
    for (const table of tables) {
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
        
        if (!error) {
            console.log(`✅ ${table} - exists (${count || 0} records)`);
        } else {
            console.log(`❌ ${table} - ${error.message}`);
        }
    }
    
    // 2. Check document types
    console.log('\n📄 Checking document types...');
    const { data: docTypes, error: docError } = await supabase
        .from('thr_document_types')
        .select('code, name, category')
        .limit(5);
    
    if (!docError && docTypes) {
        console.log(`✅ Found ${docTypes.length} document types`);
        docTypes.forEach(dt => {
            console.log(`  - ${dt.code}: ${dt.name} (${dt.category})`);
        });
        console.log('  ... and more');
    }
    
    // 3. Check if photo columns were added to employees
    console.log('\n👤 Checking employee photo columns...');
    const { data: empSample } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name, photo_url, thumbnail_url')
        .eq('employee_no', 'TS001')
        .single();
    
    if (empSample) {
        console.log('✅ Employee photo columns exist');
        console.log(`  - Employee: ${empSample.full_name}`);
        console.log(`  - Photo URL: ${empSample.photo_url || 'Not set'}`);
        console.log(`  - Thumbnail URL: ${empSample.thumbnail_url || 'Not set'}`);
    }
    
    // 4. Check storage buckets (this will fail if buckets don't exist)
    console.log('\n🗄️ Checking storage buckets...');
    const buckets = ['employee-photos', 'employee-documents', 'company-assets'];
    
    for (const bucket of buckets) {
        try {
            // Try to list files (will fail if bucket doesn't exist)
            const { data, error } = await supabase.storage
                .from(bucket)
                .list('', { limit: 1 });
            
            if (!error) {
                console.log(`✅ ${bucket} - bucket exists`);
            } else {
                console.log(`❌ ${bucket} - bucket not found (create in Supabase Dashboard)`);
            }
        } catch (err) {
            console.log(`❌ ${bucket} - bucket not found (create in Supabase Dashboard)`);
        }
    }
    
    // 5. Test upload capability
    console.log('\n🧪 Testing upload capability...');
    console.log('⚠️  Note: Actual upload test requires buckets to be created first');
    
    console.log('\n📝 Next Steps:');
    console.log('1. Go to: https://supabase.com/dashboard/project/ftbtsxlujsnobujwekwx/storage/buckets');
    console.log('2. Create the missing buckets:');
    console.log('   - employee-photos (Public)');
    console.log('   - employee-documents (Private)');
    console.log('   - company-assets (Public)');
    console.log('3. Set proper policies for each bucket');
    console.log('4. Test photo upload from the dashboard');
}

verifyStorageSetup().catch(console.error);