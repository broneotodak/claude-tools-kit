#!/usr/bin/env node

/**
 * Create basic employee view for n8n with minimal dependencies
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createBasicEmployeeView() {
    console.log('👥 Creating Basic Employee View for n8n\n');
    
    // Drop existing views
    await supabase.rpc('execute_sql', {
        sql_query: `
            DROP VIEW IF EXISTS thr_whatsapp_contacts CASCADE;
            DROP VIEW IF EXISTS thr_employees_view CASCADE;
        `
    });
    
    // Create basic view focusing on available data
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
            
            -- Simple nickname from email or first name
            CASE 
                WHEN e.contact_info->>'email' LIKE '%@%' THEN
                    SPLIT_PART(e.contact_info->>'email', '@', 1)
                WHEN e.personal_info->>'email' LIKE '%@%' THEN
                    SPLIT_PART(e.personal_info->>'email', '@', 1)
                ELSE 
                    LOWER(REGEXP_REPLACE(SPLIT_PART(e.full_name, ' ', 1), '[^a-zA-Z]', '', 'g'))
            END AS nickname,
            
            -- Phone formatting
            format_phone_for_whatsapp(
                COALESCE(
                    e.contact_info->>'phone_number',
                    e.contact_info->>'mobile_phone',
                    e.contact_info->>'personal_mobile',
                    e.personal_info->>'phone'
                )
            ) AS phone_whatsapp,
            
            -- Organization info
            o.name AS organization_name,
            o.organization_code,
            
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
            
            -- IDs
            e.organization_id,
            e.auth_user_id
            
        FROM thr_employees e
        LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
        ORDER BY e.employee_no;
    `;
    
    console.log('Creating employee view...');
    const { error: viewError } = await supabase.rpc('execute_sql', {
        sql_query: viewSQL
    });
    
    if (viewError) {
        console.error('Error creating view:', viewError);
        return;
    }
    
    console.log('✅ Employee view created\n');
    
    // Create WhatsApp view
    const whatsappSQL = `
        CREATE OR REPLACE VIEW thr_whatsapp_contacts AS
        SELECT 
            employee_id,
            employee_no,
            nickname,
            full_name,
            phone_whatsapp,
            email,
            organization_name,
            designation,
            position_name,
            is_active
        FROM thr_employees_view
        WHERE phone_whatsapp IS NOT NULL
        AND is_active = true
        ORDER BY full_name;
    `;
    
    const { error: waError } = await supabase.rpc('execute_sql', {
        sql_query: whatsappSQL
    });
    
    if (!waError) {
        console.log('✅ WhatsApp view created\n');
    }
    
    // Test the views
    console.log('📊 Testing views...\n');
    
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
            console.log(`  Phone: ${emp.phone_whatsapp}`);
            console.log(`  Organization: ${emp.organization_name || 'Not assigned'}`);
            console.log(`  Position: ${emp.position_name || emp.designation || 'N/A'}`);
        });
    }
    
    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('\n✅ VIEWS CREATED SUCCESSFULLY!\n');
    
    console.log('📋 Views for n8n:');
    console.log('  1. thr_employees_view - All employees with formatted data');
    console.log('  2. thr_whatsapp_contacts - Active employees with phones\n');
    
    console.log('🚀 n8n Usage Example:');
    console.log('```sql');
    console.log('-- Find employee by WhatsApp number');
    console.log("SELECT * FROM thr_whatsapp_contacts WHERE phone_whatsapp = '60123456789';");
    console.log('\n-- Find by nickname');
    console.log("SELECT * FROM thr_whatsapp_contacts WHERE LOWER(nickname) = 'john';");
    console.log('```\n');
    
    console.log('📱 Phone Format Examples:');
    console.log('  012-345 6789  → 60123456789');
    console.log('  +6012-3456789 → 60123456789');
    console.log('  012 3456789   → 60123456789\n');
    
    console.log('⚡ Performance Notes:');
    console.log('  - Views are computed on-demand');
    console.log('  - JOINs are minimal (only organizations)');
    console.log('  - JSONB extraction is optimized by PostgreSQL');
    console.log('  - For better performance, consider:');
    console.log('    • Creating indexes on JSONB paths');
    console.log('    • Using materialized views for heavy usage');
}

// Run
if (require.main === module) {
    createBasicEmployeeView().catch(console.error);
}

module.exports = { createBasicEmployeeView };