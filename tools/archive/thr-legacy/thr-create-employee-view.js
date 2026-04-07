#!/usr/bin/env node

/**
 * Create employee view for n8n and other integrations
 * Provides denormalized employee data with formatted phone numbers
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createEmployeeView() {
    console.log('👥 Creating THR Employee View for n8n\n');
    console.log('=' .repeat(60) + '\n');
    
    // First, create a phone formatting function
    const phoneFunction = `
        CREATE OR REPLACE FUNCTION format_phone_for_whatsapp(phone_text TEXT)
        RETURNS TEXT AS $$
        DECLARE
            cleaned_phone TEXT;
        BEGIN
            -- Return null if input is null
            IF phone_text IS NULL OR phone_text = '' THEN
                RETURN NULL;
            END IF;
            
            -- Remove all non-numeric characters
            cleaned_phone := REGEXP_REPLACE(phone_text, '[^0-9]', '', 'g');
            
            -- Handle Malaysian phone numbers
            IF LEFT(cleaned_phone, 1) = '0' THEN
                -- Replace leading 0 with 6
                cleaned_phone := '6' || SUBSTRING(cleaned_phone FROM 2);
            ELSIF LEFT(cleaned_phone, 2) = '60' THEN
                -- Already has 60, just clean
                cleaned_phone := cleaned_phone;
            ELSIF LEFT(cleaned_phone, 1) != '6' THEN
                -- Add 6 prefix if not present
                cleaned_phone := '6' || cleaned_phone;
            END IF;
            
            -- Validate length (Malaysian numbers should be 11-12 digits)
            IF LENGTH(cleaned_phone) < 10 OR LENGTH(cleaned_phone) > 13 THEN
                RETURN NULL; -- Invalid length
            END IF;
            
            RETURN cleaned_phone;
        END;
        $$ LANGUAGE plpgsql;
    `;
    
    console.log('Creating phone formatting function...');
    const { error: funcError } = await supabase.rpc('execute_sql', {
        sql_query: phoneFunction
    });
    
    if (funcError) {
        console.error('Error creating function:', funcError);
    } else {
        console.log('✅ Phone formatting function created\n');
    }
    
    // Create the main employee view
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
            e.brand_id,
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
        LEFT JOIN thr_brands b ON e.brand_id = b.id
        LEFT JOIN thr_departments d ON e.department_id = d.id
        LEFT JOIN thr_sections s ON e.section_id = s.id
        LEFT JOIN thr_positions p ON e.position_id = p.id
        ORDER BY e.employee_no;
    `;
    
    console.log('Creating employee view...');
    const { error: viewError } = await supabase.rpc('execute_sql', {
        sql_query: viewSQL
    });
    
    if (viewError) {
        console.error('Error creating view:', viewError);
    } else {
        console.log('✅ Employee view created successfully\n');
    }
    
    // Create additional views for specific use cases
    console.log('Creating specialized views...\n');
    
    // Active employees only view
    const activeViewSQL = `
        CREATE OR REPLACE VIEW thr_active_employees_view AS
        SELECT * FROM thr_employees_view
        WHERE employment_status = 'active';
    `;
    
    const { error: activeError } = await supabase.rpc('execute_sql', {
        sql_query: activeViewSQL
    });
    
    if (!activeError) {
        console.log('✅ Active employees view created');
    }
    
    // WhatsApp contacts view (simplified for n8n)
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
    
    const { error: waError } = await supabase.rpc('execute_sql', {
        sql_query: whatsappViewSQL
    });
    
    if (!waError) {
        console.log('✅ WhatsApp contacts view created');
    }
    
    // Test the view
    console.log('\n📊 Testing the view...\n');
    
    const { data: samples, error: sampleError } = await supabase
        .from('thr_employees_view')
        .select('employee_no, full_name, nickname, phone_whatsapp, organization_name')
        .limit(5);
    
    if (samples) {
        console.log('Sample data from view:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}: ${emp.full_name}`);
            console.log(`  Nickname: ${emp.nickname}`);
            console.log(`  WhatsApp: ${emp.phone_whatsapp || 'No phone'}`);
            console.log(`  Organization: ${emp.organization_name}`);
        });
    }
    
    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('\n✅ EMPLOYEE VIEWS CREATED!\n');
    
    console.log('📋 Views Created:');
    console.log('  - thr_employees_view (main denormalized view)');
    console.log('  - thr_active_employees_view (active employees only)');
    console.log('  - thr_whatsapp_contacts (for n8n WhatsApp integration)\n');
    
    console.log('🔧 Key Features:');
    console.log('  - Automatic nickname generation from email');
    console.log('  - Phone formatting for WhatsApp (6XXXXXXXXX format)');
    console.log('  - All related data joined (organization, position, etc.)');
    console.log('  - Ready for n8n webhook queries\n');
    
    console.log('📱 Phone Formatting Logic:');
    console.log('  - Removes all non-numeric characters');
    console.log('  - Converts 0 prefix to 6 (Malaysian format)');
    console.log('  - Ensures 6 prefix for all numbers');
    console.log('  - Validates length (10-13 digits)\n');
    
    console.log('🚀 Usage in n8n:');
    console.log('  - Query: SELECT * FROM thr_whatsapp_contacts WHERE phone_whatsapp = $1');
    console.log('  - Returns: All employee info needed for WhatsApp bot\n');
    
    console.log('⚡ Performance Note:');
    console.log('  Views are computed on-demand but PostgreSQL optimizes JOINs');
    console.log('  For heavy usage, consider creating materialized views');
    console.log('  Frontend can still use normalized tables for editing\n');
}

// Run
if (require.main === module) {
    createEmployeeView().catch(console.error);
}

module.exports = { createEmployeeView };