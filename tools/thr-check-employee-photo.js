#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load THR environment
require('dotenv').config({ path: path.join(__dirname, '../../THR/.env') });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function checkEmployeePhoto() {
    console.log('🔍 Checking employee photo data...\n');
    
    // Check Neo's employee record
    const { data: employee, error } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name, photo_url, thumbnail_url')
        .eq('employee_no', 'TS001')
        .single();
    
    if (error) {
        console.error('❌ Error fetching employee:', error);
        return;
    }
    
    console.log('👤 Employee Record:');
    console.log(`  - Name: ${employee.full_name}`);
    console.log(`  - Employee No: ${employee.employee_no}`);
    console.log(`  - Photo URL: ${employee.photo_url || 'NOT SET'}`);
    console.log(`  - Thumbnail URL: ${employee.thumbnail_url || 'NOT SET'}`);
    
    // Check photo records
    console.log('\n📸 Photo Records:');
    const { data: photos, error: photoError } = await supabase
        .from('thr_employee_photos')
        .select('*')
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false });
    
    if (photoError) {
        console.error('❌ Error fetching photos:', photoError);
        return;
    }
    
    if (photos && photos.length > 0) {
        photos.forEach((photo, index) => {
            console.log(`\n  Photo ${index + 1}:`);
            console.log(`  - ID: ${photo.id}`);
            console.log(`  - URL: ${photo.photo_url}`);
            console.log(`  - Is Primary: ${photo.is_primary}`);
            console.log(`  - Created: ${new Date(photo.created_at).toLocaleString()}`);
        });
        
        // Test if the URL is accessible
        const testUrl = photos[0].photo_url;
        console.log(`\n🌐 Testing photo URL accessibility...`);
        try {
            const response = await fetch(testUrl);
            if (response.ok) {
                console.log('✅ Photo URL is accessible');
                console.log(`  - Status: ${response.status}`);
                console.log(`  - Content-Type: ${response.headers.get('content-type')}`);
            } else {
                console.log(`❌ Photo URL returned status: ${response.status}`);
            }
        } catch (err) {
            console.log('❌ Failed to fetch photo:', err.message);
        }
    } else {
        console.log('  No photos found');
    }
    
    // Manual update if needed
    if (!employee.photo_url && photos && photos.length > 0) {
        console.log('\n⚠️  Employee photo_url is not set but photos exist!');
        console.log('🔧 Updating employee record with latest photo...');
        
        const latestPhoto = photos[0];
        const { error: updateError } = await supabase
            .from('thr_employees')
            .update({
                photo_url: latestPhoto.photo_url,
                thumbnail_url: latestPhoto.thumbnail_url || latestPhoto.photo_url
            })
            .eq('id', employee.id);
        
        if (updateError) {
            console.error('❌ Update failed:', updateError);
        } else {
            console.log('✅ Employee record updated with photo URL');
        }
    }
}

checkEmployeePhoto().catch(console.error);