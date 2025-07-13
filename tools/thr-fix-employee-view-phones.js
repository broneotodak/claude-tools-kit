#!/usr/bin/env node

/**
 * Fix employee view with correct phone path
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixEmployeeViewPhones() {
    console.log('🔧 Fixing Employee View Phone Extraction\n');
    
    // Drop and recreate views with correct paths
    const viewSQL = `
        -- Drop existing views
        DROP VIEW IF EXISTS thr_whatsapp_contacts CASCADE;
        DROP VIEW IF EXISTS thr_employees_view CASCADE;
        
        -- Recreate with correct phone paths
        CREATE OR REPLACE VIEW thr_employees_view AS
        SELECT 
            -- Core identification
            e.id AS employee_id,
            e.employee_no,
            e.full_name,
            
            -- Extract email from nested structure
            COALESCE(
                e.contact_info->'emails'->>'personal',
                e.contact_info->'emails'->>'company',
                e.contact_info->'emails'->>'work'
            ) AS email,
            
            -- Nickname from email
            CASE 
                WHEN e.contact_info->'emails'->>'personal' LIKE '%@%' THEN
                    SPLIT_PART(e.contact_info->'emails'->>'personal', '@', 1)
                WHEN e.contact_info->'emails'->>'company' LIKE '%@%' THEN
                    SPLIT_PART(e.contact_info->'emails'->>'company', '@', 1)
                ELSE 
                    LOWER(REGEXP_REPLACE(SPLIT_PART(e.full_name, ' ', 1), '[^a-zA-Z]', '', 'g'))
            END AS nickname,
            
            -- Phone extraction from nested structure
            e.contact_info->'phone'->>'mobile' AS phone_original,
            format_phone_for_whatsapp(e.contact_info->'phone'->>'mobile') AS phone_whatsapp,
            
            -- Organization info
            o.name AS organization_name,
            o.organization_code,
            b.name AS brand_name,
            
            -- Employment info from JSONB
            e.employment_info->>'designation' AS designation,
            e.employment_info->>'position' AS position_name,
            e.employment_info->>'department' AS department_name,
            
            -- Status
            e.employment_status,
            e.active_status,
            CASE 
                WHEN e.employment_status = 'active' THEN true 
                ELSE false 
            END AS is_active,
            
            -- Dates
            (e.employment_info->>'join_date')::date AS join_date,
            (e.employment_info->>'confirmation_date')::date AS confirmation_date,
            (e.employment_info->>'resign_date')::date AS resign_date,
            
            -- Financial
            (e.compensation->>'basic_salary')::decimal AS basic_salary,
            
            -- Address from personal_info
            e.personal_info->>'address' AS address,
            e.personal_info->>'city' AS city,
            e.personal_info->>'state' AS state,
            e.personal_info->>'postcode' AS postcode,
            
            -- IDs
            e.organization_id,
            o.brand_id,
            e.department_id,
            e.position_id,
            e.auth_user_id
            
        FROM thr_employees e
        LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
        LEFT JOIN thr_brands b ON o.brand_id = b.brand_id
        ORDER BY e.employee_no;
    `;
    
    console.log('Creating corrected employee view...');
    const { error: viewError } = await supabase.rpc('execute_sql', {
        sql_query: viewSQL
    });
    
    if (viewError) {
        console.error('Error:', viewError);
        return;
    }
    
    console.log('✅ Employee view recreated with correct phone paths\n');
    
    // Create WhatsApp view
    const whatsappSQL = `
        CREATE OR REPLACE VIEW thr_whatsapp_contacts AS
        SELECT 
            employee_id,
            employee_no,
            nickname,
            full_name,
            phone_whatsapp,
            phone_original,
            email,
            organization_name,
            brand_name,
            designation,
            position_name,
            is_active
        FROM thr_employees_view
        WHERE phone_whatsapp IS NOT NULL
        AND is_active = true
        ORDER BY full_name;
    `;
    
    await supabase.rpc('execute_sql', { sql_query: whatsappSQL });
    console.log('✅ WhatsApp view recreated\n');
    
    // Test the views
    console.log('📊 Testing phone extraction...\n');
    
    const { data: samples, count } = await supabase
        .from('thr_whatsapp_contacts')
        .select('*', { count: 'exact' })
        .limit(5);
    
    console.log(`Found ${count || 0} WhatsApp-ready employees\n`);
    
    if (samples && samples.length > 0) {
        console.log('Sample WhatsApp contacts:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}: ${emp.full_name}`);
            console.log(`  Nickname: ${emp.nickname}`);
            console.log(`  Original: ${emp.phone_original}`);
            console.log(`  WhatsApp: ${emp.phone_whatsapp}`);
            console.log(`  Email: ${emp.email || 'No email'}`);
            console.log(`  Organization: ${emp.organization_name} (${emp.brand_name || 'No brand'})`);
        });
    }
    
    // Check employees without phones
    const { count: noPhoneCount } = await supabase
        .from('thr_employees_view')
        .select('*', { count: 'exact', head: true })
        .is('phone_whatsapp', null)
        .eq('is_active', true);
    
    console.log(`\n📱 Active employees without WhatsApp phones: ${noPhoneCount || 0}`);
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ VIEWS FIXED AND READY!\n');
    
    console.log('📋 Available Views:');
    console.log('  1. thr_employees_view - Full employee data');
    console.log('  2. thr_whatsapp_contacts - WhatsApp-ready contacts\n');
    
    console.log('🚀 n8n Integration Query:');
    console.log('```sql');
    console.log("SELECT * FROM thr_whatsapp_contacts");
    console.log("WHERE phone_whatsapp = '{{$json.from}}'");
    console.log('```\n');
    
    console.log('📱 Data Structure:');
    console.log('  Phone path: contact_info → phone → mobile');
    console.log('  Email path: contact_info → emails → personal/company');
    console.log('  All phones formatted to WhatsApp format (60XXXXXXXXX)\n');
}

// Run
if (require.main === module) {
    fixEmployeeViewPhones().catch(console.error);
}

module.exports = { fixEmployeeViewPhones };