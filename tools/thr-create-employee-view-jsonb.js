#!/usr/bin/env node

/**
 * Create employee view extracting data from JSONB fields
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createEmployeeViewWithJSONB() {
    console.log('👥 Creating Employee View with JSONB extraction\n');
    
    // Drop existing views
    await supabase.rpc('execute_sql', {
        sql_query: `
            DROP VIEW IF EXISTS thr_whatsapp_contacts CASCADE;
            DROP VIEW IF EXISTS thr_active_employees_view CASCADE;
            DROP VIEW IF EXISTS thr_employees_view CASCADE;
            DROP VIEW IF EXISTS thr_employees_simple CASCADE;
        `
    });
    
    // Create the main employee view extracting from JSONB
    const viewSQL = `
        CREATE OR REPLACE VIEW thr_employees_view AS
        SELECT 
            -- Core identification
            e.id AS employee_id,
            e.employee_no,
            e.full_name,
            
            -- Extract email and create nickname
            COALESCE(
                e.contact_info->>'email',
                e.personal_info->>'email'
            ) AS email,
            
            CASE 
                WHEN e.contact_info->>'email' IS NOT NULL AND e.contact_info->>'email' LIKE '%@%' THEN
                    SPLIT_PART(e.contact_info->>'email', '@', 1)
                WHEN e.personal_info->>'email' IS NOT NULL AND e.personal_info->>'email' LIKE '%@%' THEN
                    SPLIT_PART(e.personal_info->>'email', '@', 1)
                ELSE 
                    LOWER(SPLIT_PART(e.full_name, ' ', 1))
            END AS nickname,
            
            -- Phone numbers
            format_phone_for_whatsapp(
                COALESCE(
                    e.contact_info->>'phone_number',
                    e.contact_info->>'mobile_phone',
                    e.contact_info->>'personal_mobile',
                    e.personal_info->>'phone'
                )
            ) AS phone_whatsapp,
            
            COALESCE(
                e.contact_info->>'phone_number',
                e.contact_info->>'mobile_phone',
                e.contact_info->>'personal_mobile',
                e.personal_info->>'phone'
            ) AS phone_original,
            
            -- Organization & Position
            o.name AS organization_name,
            o.organization_code,
            b.name AS brand_name,
            p.name AS position_name,
            e.employment_info->>'designation' AS designation,
            d.name AS department_name,
            s.name AS section_name,
            
            -- Employment status
            e.employment_status,
            e.employment_info->>'employee_type' AS employee_type,
            e.employment_info->>'staff_category' AS staff_category,
            
            -- Key dates
            (e.employment_info->>'join_date')::date AS join_date,
            (e.employment_info->>'confirmation_date')::date AS confirmation_date,
            (e.employment_info->>'resign_date')::date AS resign_date,
            
            -- Financial basics
            (e.compensation->>'basic_salary')::decimal AS basic_salary,
            e.bank_info->>'account_no' AS bank_account_no,
            e.bank_info->>'bank_name' AS bank_name,
            
            -- Address from personal_info
            e.personal_info->>'address' AS address,
            e.personal_info->>'city' AS city,
            e.personal_info->>'state' AS state,
            e.personal_info->>'postcode' AS postcode,
            e.personal_info->>'country' AS country,
            
            -- Emergency contact
            e.contact_info->>'emergency_contact_name' AS emergency_contact_name,
            format_phone_for_whatsapp(e.contact_info->>'emergency_contact_phone') AS emergency_phone_whatsapp,
            
            -- IDs for relationships
            e.organization_id,
            o.brand_id,
            e.department_id,
            e.section_id,
            e.position_id,
            
            -- Authentication link
            e.auth_user_id,
            
            -- Status fields
            e.active_status,
            CASE 
                WHEN e.employment_status = 'active' THEN true 
                ELSE false 
            END AS is_active,
            
            -- Metadata
            e.created_at,
            e.updated_at,
            
            -- Full address concatenation
            CONCAT_WS(', ', 
                NULLIF(e.personal_info->>'address', ''),
                NULLIF(e.personal_info->>'city', ''),
                NULLIF(e.personal_info->>'state', ''),
                NULLIF(e.personal_info->>'postcode', ''),
                NULLIF(e.personal_info->>'country', '')
            ) AS full_address
            
        FROM thr_employees e
        LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
        LEFT JOIN thr_brands b ON o.brand_id = b.brand_id
        LEFT JOIN thr_departments d ON e.department_id = d.id
        LEFT JOIN thr_sections s ON e.section_id = s.id
        LEFT JOIN thr_positions p ON e.position_id = p.id
        ORDER BY e.employee_no;
    `;
    
    console.log('Creating main employee view...');
    const { error: viewError } = await supabase.rpc('execute_sql', {
        sql_query: viewSQL
    });
    
    if (viewError) {
        console.error('Error creating view:', viewError);
        return;
    }
    
    console.log('✅ Employee view created successfully\n');
    
    // Create active employees view
    const activeViewSQL = `
        CREATE OR REPLACE VIEW thr_active_employees_view AS
        SELECT * FROM thr_employees_view
        WHERE employment_status = 'active';
    `;
    
    await supabase.rpc('execute_sql', { sql_query: activeViewSQL });
    console.log('✅ Active employees view created');
    
    // Create WhatsApp contacts view
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
            designation,
            is_active
        FROM thr_employees_view
        WHERE phone_whatsapp IS NOT NULL
        AND is_active = true
        ORDER BY full_name;
    `;
    
    await supabase.rpc('execute_sql', { sql_query: whatsappViewSQL });
    console.log('✅ WhatsApp contacts view created');
    
    // Test the views
    console.log('\n📊 Testing views...\n');
    
    // Get sample data
    const { data: samples } = await supabase
        .from('thr_employees_view')
        .select('employee_no, full_name, nickname, email, phone_whatsapp, organization_name')
        .limit(5);
    
    if (samples && samples.length > 0) {
        console.log('Sample employees:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}: ${emp.full_name}`);
            console.log(`  Nickname: ${emp.nickname}`);
            console.log(`  Email: ${emp.email || 'No email'}`);
            console.log(`  WhatsApp: ${emp.phone_whatsapp || 'No phone'}`);
            console.log(`  Organization: ${emp.organization_name || 'Not assigned'}`);
        });
    }
    
    // Count WhatsApp-ready employees
    const { count: waCount } = await supabase
        .from('thr_whatsapp_contacts')
        .select('*', { count: 'exact', head: true });
    
    console.log(`\n📱 WhatsApp-ready employees: ${waCount || 0}`);
    
    // Performance explanation
    console.log('\n\n' + '='.repeat(60));
    console.log('\n✅ VIEWS CREATED SUCCESSFULLY!\n');
    
    console.log('📋 Views Available:');
    console.log('  1. thr_employees_view - Full denormalized view');
    console.log('  2. thr_active_employees_view - Active employees only');
    console.log('  3. thr_whatsapp_contacts - For n8n WhatsApp bot\n');
    
    console.log('🚀 n8n Integration:');
    console.log('  Use this query in your n8n webhook:');
    console.log('  SELECT * FROM thr_whatsapp_contacts WHERE phone_whatsapp = $1\n');
    
    console.log('⚡ About Performance:');
    console.log('  1. Views run JOINs on-demand - PostgreSQL optimizes these');
    console.log('  2. For frontend, you can still use normalized tables');
    console.log('  3. Views are best for read operations (perfect for n8n)');
    console.log('  4. If performance becomes an issue, we can:');
    console.log('     - Create materialized views (cached)');
    console.log('     - Add indexes on JSONB fields');
    console.log('     - Create dedicated lookup tables\n');
    
    console.log('📱 Phone Format:');
    console.log('  All phones formatted to: 6XXXXXXXXX (WhatsApp ready)');
    console.log('  Example: 012-3456789 → 60123456789\n');
}

// Run
if (require.main === module) {
    createEmployeeViewWithJSONB().catch(console.error);
}

module.exports = { createEmployeeViewWithJSONB };