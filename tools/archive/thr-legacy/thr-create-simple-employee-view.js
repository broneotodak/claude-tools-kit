#!/usr/bin/env node

/**
 * Create simplified employee view for n8n
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createSimpleEmployeeView() {
    console.log('👥 Creating Simplified Employee View\n');
    
    // First check what columns we actually have
    const { data: columns } = await supabase.rpc('execute_sql', {
        sql_query: `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'thr_employees' 
            ORDER BY ordinal_position
        `
    });
    
    console.log('Available columns in thr_employees:');
    columns?.forEach(col => console.log(`  - ${col.column_name} (${col.data_type})`));
    
    // Create simplified view without problematic joins first
    const simpleViewSQL = `
        CREATE OR REPLACE VIEW thr_employees_simple AS
        SELECT 
            -- Core identification
            e.id AS employee_id,
            e.employee_no,
            e.full_name,
            
            -- Nickname from email
            CASE 
                WHEN e.email IS NOT NULL AND e.email LIKE '%@%' THEN
                    SPLIT_PART(e.email, '@', 1)
                ELSE 
                    LOWER(SPLIT_PART(e.full_name, ' ', 1))
            END AS nickname,
            
            -- Contact
            e.email,
            format_phone_for_whatsapp(e.phone_number) AS phone_whatsapp,
            e.phone_number AS phone_original,
            e.designation,
            
            -- Status
            e.employment_status,
            CASE 
                WHEN e.employment_status = 'active' THEN true 
                ELSE false 
            END AS is_active,
            
            -- Organization info (will join separately)
            e.organization_id,
            e.department_id,
            e.section_id,
            e.position_id,
            
            -- Dates
            e.join_date,
            e.resign_date
            
        FROM thr_employees e;
    `;
    
    console.log('\nCreating simple employee view...');
    const { error: simpleError } = await supabase.rpc('execute_sql', {
        sql_query: simpleViewSQL
    });
    
    if (simpleError) {
        console.error('Error:', simpleError);
        return;
    }
    
    console.log('✅ Simple view created');
    
    // Now create the full view with proper joins
    const fullViewSQL = `
        CREATE OR REPLACE VIEW thr_employees_view AS
        SELECT 
            e.*,
            o.name AS organization_name,
            o.organization_code,
            b.name AS brand_name,
            p.name AS position_name,
            d.name AS department_name,
            s.name AS section_name
        FROM thr_employees_simple e
        LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
        LEFT JOIN thr_brands b ON o.brand_id = b.brand_id
        LEFT JOIN thr_departments d ON e.department_id = d.id
        LEFT JOIN thr_sections s ON e.section_id = s.id
        LEFT JOIN thr_positions p ON e.position_id = p.id;
    `;
    
    console.log('\nCreating full employee view...');
    const { error: fullError } = await supabase.rpc('execute_sql', {
        sql_query: fullViewSQL
    });
    
    if (fullError) {
        console.error('Error:', fullError);
    } else {
        console.log('✅ Full view created');
    }
    
    // Create WhatsApp-specific view
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
            position_name,
            designation,
            is_active
        FROM thr_employees_view
        WHERE phone_whatsapp IS NOT NULL
        AND is_active = true;
    `;
    
    console.log('\nCreating WhatsApp contacts view...');
    const { error: waError } = await supabase.rpc('execute_sql', {
        sql_query: whatsappSQL
    });
    
    if (!waError) {
        console.log('✅ WhatsApp view created');
    }
    
    // Test the views
    console.log('\n📊 Testing views...\n');
    
    const { data: sample, count } = await supabase
        .from('thr_whatsapp_contacts')
        .select('*', { count: 'exact' })
        .limit(3);
    
    if (sample) {
        console.log(`Found ${count} WhatsApp-ready employees\n`);
        console.log('Sample data:');
        sample.forEach(emp => {
            console.log(`\n${emp.employee_no}: ${emp.full_name}`);
            console.log(`  Nickname: ${emp.nickname}`);
            console.log(`  WhatsApp: ${emp.phone_whatsapp}`);
            console.log(`  Organization: ${emp.organization_name || 'N/A'}`);
        });
    }
    
    console.log('\n\n✅ Views created successfully!');
    console.log('\n🚀 For n8n usage:');
    console.log('  Query: SELECT * FROM thr_whatsapp_contacts WHERE phone_whatsapp = $1');
    console.log('  Returns: employee_id, nickname, full_name, organization_name, etc.');
}

// Run
if (require.main === module) {
    createSimpleEmployeeView().catch(console.error);
}

module.exports = { createSimpleEmployeeView };