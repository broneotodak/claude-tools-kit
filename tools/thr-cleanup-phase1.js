#!/usr/bin/env node

/**
 * THR Database Cleanup - Phase 1
 * Consolidates contact information into JSONB format
 * Preserves all existing data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function consolidateContactInfo() {
    console.log('📧 Phase 1: Consolidating Contact Information\n');
    
    // First, add the new contact_info column if it doesn't exist
    console.log('1️⃣ Adding contact_info JSONB column...');
    
    const { error: alterError } = await supabase.rpc('execute_sql', {
        sql_query: `
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'master_hr2000' 
                    AND column_name = 'contact_info'
                ) THEN
                    ALTER TABLE master_hr2000 ADD COLUMN contact_info JSONB;
                END IF;
            END $$;
        `
    });
    
    if (alterError) {
        console.error('Error adding column:', alterError);
        return;
    }
    
    console.log('✅ Column added/verified\n');
    
    // Get all employees
    console.log('2️⃣ Fetching employee data...');
    const { data: employees, error: fetchError } = await supabase
        .from('master_hr2000')
        .select(`
            id,
            employee_no,
            mobile,
            personal_email,
            company_email,
            address,
            address2,
            city,
            state,
            postcode,
            country
        `);
    
    if (fetchError) {
        console.error('Error fetching employees:', fetchError);
        return;
    }
    
    console.log(`Found ${employees.length} employees to process\n`);
    
    // Process each employee
    console.log('3️⃣ Consolidating contact information...');
    let processed = 0;
    let hasData = 0;
    
    for (const emp of employees) {
        // Build contact_info object
        const contactInfo = {};
        
        // Emails
        if (emp.personal_email || emp.company_email) {
            contactInfo.emails = {};
            if (emp.personal_email) contactInfo.emails.personal = emp.personal_email;
            if (emp.company_email) contactInfo.emails.company = emp.company_email;
        }
        
        // Phone
        if (emp.mobile) {
            contactInfo.phone = {
                mobile: emp.mobile
            };
        }
        
        // Address (only if any field has data)
        if (emp.address || emp.address2 || emp.city || emp.state || emp.postcode || emp.country) {
            contactInfo.address = {};
            if (emp.address) contactInfo.address.line1 = emp.address;
            if (emp.address2) contactInfo.address.line2 = emp.address2;
            if (emp.city) contactInfo.address.city = emp.city;
            if (emp.state) contactInfo.address.state = emp.state;
            if (emp.postcode) contactInfo.address.postcode = emp.postcode;
            if (emp.country) contactInfo.address.country = emp.country;
        }
        
        // Only update if there's contact data
        if (Object.keys(contactInfo).length > 0) {
            const { error: updateError } = await supabase
                .from('master_hr2000')
                .update({ 
                    contact_info: contactInfo,
                    updated_at: new Date().toISOString()
                })
                .eq('id', emp.id);
            
            if (updateError) {
                console.error(`Error updating ${emp.employee_no}:`, updateError);
            } else {
                hasData++;
            }
        }
        
        processed++;
        if (processed % 50 === 0) {
            console.log(`  Processed ${processed}/${employees.length} employees...`);
        }
    }
    
    console.log(`\n✅ Consolidation complete!`);
    console.log(`  - Total processed: ${processed}`);
    console.log(`  - With contact data: ${hasData}`);
    console.log(`  - Empty contact info: ${processed - hasData}`);
    
    // Verify the consolidation
    console.log('\n4️⃣ Verifying consolidation...');
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, contact_info')
        .not('contact_info', 'is', null)
        .limit(3);
    
    if (!sampleError && samples) {
        console.log('\n📋 Sample contact_info records:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}:`, JSON.stringify(emp.contact_info, null, 2));
        });
    }
    
    console.log('\n✅ Phase 1 Complete!');
    console.log('\n⚠️  Original columns preserved. To remove them after verification:');
    console.log('```sql');
    console.log('ALTER TABLE master_hr2000');
    console.log('DROP COLUMN mobile,');
    console.log('DROP COLUMN personal_email,');
    console.log('DROP COLUMN company_email,');
    console.log('DROP COLUMN address,');
    console.log('DROP COLUMN address2,');
    console.log('DROP COLUMN city,');
    console.log('DROP COLUMN state,');
    console.log('DROP COLUMN postcode,');
    console.log('DROP COLUMN country;');
    console.log('```');
}

// Run consolidation
if (require.main === module) {
    consolidateContactInfo().catch(console.error);
}

module.exports = { consolidateContactInfo };