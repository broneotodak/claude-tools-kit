#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load THR environment
require('dotenv').config({ path: path.join(__dirname, '../../THR/.env') });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function checkViewPhoto() {
    console.log('🔍 Checking if thr_employees_view includes photo fields...\n');
    
    // Test the view
    const { data, error } = await supabase
        .from('thr_employees_view')
        .select('employee_id, full_name, email, photo_url, thumbnail_url')
        .eq('email', 'neo@todak.com')
        .single();
    
    if (error) {
        if (error.message.includes('photo_url')) {
            console.log('❌ The view does not include photo_url field');
            console.log('🔧 Need to recreate the view with photo fields');
            
            // Show the fix
            console.log('\n📝 Run this SQL to fix the view:');
            console.log(`
DROP VIEW IF EXISTS thr_employees_view;

CREATE VIEW thr_employees_view AS
SELECT 
    e.id AS employee_id,
    e.employee_no,
    e.full_name,
    e.contact_info->>'email' AS email,
    e.photo_url,
    e.thumbnail_url,
    -- ... rest of the existing fields ...
    o.name AS organization_name,
    o.code AS organization_code,
    d.name AS department_name,
    p.title AS position_title
FROM thr_employees e
LEFT JOIN thr_organizations o ON e.organization_id = o.id
LEFT JOIN thr_departments d ON e.department_id = d.id
LEFT JOIN thr_positions p ON e.position_id = p.id
WHERE e.deleted_at IS NULL;
            `);
        } else {
            console.error('❌ Error:', error);
        }
        return;
    }
    
    console.log('✅ View data retrieved:');
    console.log(JSON.stringify(data, null, 2));
    
    if (!data.photo_url) {
        console.log('\n⚠️  photo_url is null in the view, but field exists');
        
        // Check if the base table has the photo
        const { data: empData } = await supabase
            .from('thr_employees')
            .select('photo_url, thumbnail_url')
            .eq('employee_no', 'TS001')
            .single();
        
        if (empData?.photo_url) {
            console.log('✅ Base table has photo_url:', empData.photo_url);
            console.log('❓ View might need to be refreshed or recreated');
        }
    }
}

checkViewPhoto().catch(console.error);