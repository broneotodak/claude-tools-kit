#!/usr/bin/env node

/**
 * Fix employee view - remove brand_id reference
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixEmployeeView() {
    console.log('🔧 Fixing Employee View\n');
    
    // Drop existing views first
    const dropViews = `
        DROP VIEW IF EXISTS thr_whatsapp_contacts CASCADE;
        DROP VIEW IF EXISTS thr_active_employees_view CASCADE;
        DROP VIEW IF EXISTS thr_employees_view CASCADE;
    `;
    
    await supabase.rpc('execute_sql', { sql_query: dropViews });
    
    // Create the corrected view
    const viewSQL = `
        CREATE OR REPLACE VIEW thr_employees_view AS
        SELECT 
            -- Core identification
            e.id AS employee_id,
            e.employee_no,
            e.full_name,
            
            -- Nickname generation (from email prefix)
            CASE 
                WHEN e.email IS NOT NULL AND e.email LIKE '%@%' THEN
                    SPLIT_PART(e.email, '@', 1)
                ELSE 
                    LOWER(REGEXP_REPLACE(SPLIT_PART(e.full_name, ' ', 1), '[^a-zA-Z]', '', 'g'))
            END AS nickname,
            
            -- Contact information
            e.email,
            format_phone_for_whatsapp(e.phone_number) AS phone_whatsapp,
            e.phone_number AS phone_original,
            
            -- Organization & Position
            o.name AS organization_name,
            o.organization_code,
            b.name AS brand_name,
            p.name AS position_name,
            e.designation,
            d.name AS department_name,
            s.name AS section_name,
            
            -- Employment status
            e.employment_status,
            e.employee_type,
            e.staff_category,
            
            -- Key dates
            e.join_date,
            e.confirmation_date,
            e.resign_date,
            
            -- Financial basics
            e.basic_salary,
            e.bank_account_no,
            e.bank_name,
            
            -- Additional info from JSONB
            e.contact_info->>'personal_mobile' AS personal_mobile,
            format_phone_for_whatsapp(e.contact_info->>'personal_mobile') AS personal_mobile_whatsapp,
            e.contact_info->>'home_phone' AS home_phone,
            e.contact_info->>'emergency_contact_name' AS emergency_contact_name,
            e.contact_info->>'emergency_contact_phone' AS emergency_contact_phone,
            format_phone_for_whatsapp(e.contact_info->>'emergency_contact_phone') AS emergency_phone_whatsapp,
            
            -- Address
            e.address,
            e.city,
            e.state,
            e.postcode,
            e.country,
            
            -- IDs for relationships
            e.organization_id,
            o.brand_id,
            e.department_id,
            e.section_id,
            e.position_id,
            
            -- Authentication link
            e.auth_user_id,
            
            -- Metadata
            e.created_at,
            e.updated_at,
            
            -- Computed fields for quick access
            CASE 
                WHEN e.employment_status = 'active' THEN true 
                ELSE false 
            END AS is_active,
            
            -- Full address concatenation
            CONCAT_WS(', ', 
                NULLIF(e.address, ''),
                NULLIF(e.city, ''),
                NULLIF(e.state, ''),
                NULLIF(e.postcode, ''),
                NULLIF(e.country, '')
            ) AS full_address
            
        FROM thr_employees e
        LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
        LEFT JOIN thr_brands b ON o.brand_id = b.id
        LEFT JOIN thr_departments d ON e.department_id = d.id
        LEFT JOIN thr_sections s ON e.section_id = s.id
        LEFT JOIN thr_positions p ON e.position_id = p.id
        ORDER BY e.employee_no;
    `;
    
    console.log('Creating corrected employee view...');
    const { error: viewError } = await supabase.rpc('execute_sql', {
        sql_query: viewSQL
    });
    
    if (viewError) {
        console.error('Error creating view:', viewError);
        return;
    }
    
    console.log('✅ Employee view created successfully\n');
    
    // Recreate additional views
    const activeViewSQL = `
        CREATE OR REPLACE VIEW thr_active_employees_view AS
        SELECT * FROM thr_employees_view
        WHERE employment_status = 'active';
    `;
    
    await supabase.rpc('execute_sql', { sql_query: activeViewSQL });
    console.log('✅ Active employees view created');
    
    const whatsappViewSQL = `
        CREATE OR REPLACE VIEW thr_whatsapp_contacts AS
        SELECT 
            employee_id,
            employee_no,
            nickname,
            full_name,
            phone_whatsapp,
            email,
            organization_name,
            position_name,
            is_active
        FROM thr_employees_view
        WHERE phone_whatsapp IS NOT NULL
        AND is_active = true;
    `;
    
    await supabase.rpc('execute_sql', { sql_query: whatsappViewSQL });
    console.log('✅ WhatsApp contacts view created');
    
    // Test the view
    console.log('\n📊 Testing the view...\n');
    
    const { data: samples } = await supabase
        .from('thr_employees_view')
        .select('employee_no, full_name, nickname, phone_whatsapp, organization_name')
        .limit(5);
    
    if (samples) {
        console.log('Sample data:');
        samples.forEach(emp => {
            console.log(`${emp.employee_no}: ${emp.full_name} (${emp.nickname}) - ${emp.organization_name}`);
        });
    }
    
    // Check WhatsApp-ready employees
    const { count } = await supabase
        .from('thr_whatsapp_contacts')
        .select('*', { count: 'exact', head: true });
    
    console.log(`\n📱 WhatsApp-ready employees: ${count || 0}`);
}

// Run
if (require.main === module) {
    fixEmployeeView().catch(console.error);
}

module.exports = { fixEmployeeView };