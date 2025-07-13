#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_ANON_KEY // Using anon key like frontend would
);

async function testPhotoUpload() {
    console.log('📸 Testing photo upload functionality...\n');
    
    const employeeId = 'f221e445-ac90-4417-852b-ab76d792bd0c';
    const employeeNo = 'TS001';
    
    // 1. Create a test image file (1x1 pixel transparent PNG)
    const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const imageBuffer = Buffer.from(base64Image, 'base64');
    
    // 2. Test upload to storage
    console.log('🚀 Attempting to upload test image...');
    
    const fileName = `test_${Date.now()}.png`;
    const filePath = `TS/${employeeNo}/${fileName}`;
    
    try {
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('employee-photos')
            .upload(filePath, imageBuffer, {
                contentType: 'image/png',
                cacheControl: '3600',
                upsert: false
            });
        
        if (uploadError) {
            console.error('❌ Upload error:', uploadError);
            return;
        }
        
        console.log('✅ Upload successful!');
        console.log('📍 Path:', uploadData.path);
        
        // 3. Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('employee-photos')
            .getPublicUrl(filePath);
        
        console.log('🔗 Public URL:', publicUrl);
        
        // 4. Save to database
        const { data: photoRecord, error: dbError } = await supabase
            .from('thr_employee_photos')
            .insert({
                employee_id: employeeId,
                photo_url: publicUrl,
                thumbnail_url: publicUrl + '?width=200',
                file_name: fileName,
                file_size: imageBuffer.length,
                mime_type: 'image/png',
                is_primary: false, // Don't override existing primary
                uploaded_by: employeeId
            })
            .select()
            .single();
        
        if (dbError) {
            console.error('❌ Database error:', dbError);
        } else {
            console.log('✅ Database record created');
            console.log('📋 Photo ID:', photoRecord.id);
        }
        
        // 5. Clean up test file
        console.log('\n🧹 Cleaning up test file...');
        const { error: deleteError } = await supabase.storage
            .from('employee-photos')
            .remove([filePath]);
        
        if (!deleteError) {
            console.log('✅ Test file removed');
            
            // Also remove from database
            if (photoRecord) {
                await supabase
                    .from('thr_employee_photos')
                    .delete()
                    .eq('id', photoRecord.id);
            }
        }
        
        console.log('\n✨ Storage test completed successfully!');
        console.log('📱 You can now upload photos from the dashboard');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testPhotoUpload().catch(console.error);