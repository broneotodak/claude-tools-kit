#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Try loading from THR project env
const envPath = require('path').join(__dirname, '../../THR/.env');
require('dotenv').config({ path: envPath });

// Try both anon and service role keys
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.ATLAS_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.ATLAS_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey) {
    console.error('❌ Missing Supabase credentials. Please check your .env file.');
    process.exit(1);
}

const supabaseAnon = createClient(supabaseUrl, anonKey);

const supabaseService = serviceKey 
    ? createClient(supabaseUrl, serviceKey)
    : null;

async function checkBucketAccess() {
    console.log('🔍 Checking storage bucket access...\n');
    
    const buckets = ['employee-photos', 'employee-documents', 'company-assets'];
    
    console.log('Testing with ANON key (frontend):');
    for (const bucket of buckets) {
        try {
            const { data, error } = await supabaseAnon.storage
                .from(bucket)
                .list('', { limit: 1 });
            
            if (!error) {
                console.log(`✅ ${bucket} - Can list files`);
            } else {
                console.log(`❌ ${bucket} - ${error.message}`);
            }
        } catch (err) {
            console.log(`❌ ${bucket} - Error: ${err.message}`);
        }
    }
    
    if (supabaseService) {
        console.log('\nTesting with SERVICE ROLE key:');
        for (const bucket of buckets) {
            try {
                const { data, error } = await supabaseService.storage
                    .from(bucket)
                    .list('', { limit: 1 });
                
                if (!error) {
                    console.log(`✅ ${bucket} - Can list files`);
                } else {
                    console.log(`❌ ${bucket} - ${error.message}`);
                }
            } catch (err) {
                console.log(`❌ ${bucket} - Error: ${err.message}`);
            }
        }
    } else {
        console.log('\n⚠️  No SERVICE ROLE key found - skipping service role tests');
    }
    
    // Try creating buckets if they don't exist
    console.log('\n📦 Bucket Configuration:');
    console.log('If buckets show "not found", create them in Supabase Dashboard:');
    console.log('1. Go to Storage section');
    console.log('2. Click "New bucket"');
    console.log('3. Set these exact names:');
    console.log('   - employee-photos (make it PUBLIC)');
    console.log('   - employee-documents (keep PRIVATE)');
    console.log('   - company-assets (make it PUBLIC)');
}

checkBucketAccess().catch(console.error);