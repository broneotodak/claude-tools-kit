#!/usr/bin/env node

/**
 * THR SOCSO Contribution Migration
 * Migrates SOCSO contribution rates based on standard Malaysian rates
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Connect to THR_neo (previously ATLAS) database
const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// SOCSO contribution rates (Malaysian standard)
const SOCSO_RATES = {
    'S1': {
        employee: 0.5,   // 0.5% for employees under 60
        employer: 1.75   // 1.75% for employees under 60
    }
    // Note: For 60+, rates would be 0% employee, 1.25% employer
    // But all our data shows S1 group (under 60)
};

/**
 * Main migration function
 */
async function migrateSocsoContributions() {
    console.log('🔍 Starting SOCSO contribution rates migration...');
    console.log('Applying standard Malaysian SOCSO rates for S1 group\n');
    
    // Update all records that have socso_group = 'S1'
    const { data: employees, error: fetchError } = await supabase
        .from('master_hr2000')
        .select('employee_no, socso_group')
        .eq('socso_group', 'S1');

    if (fetchError) {
        console.error('❌ Error fetching employees:', fetchError);
        return;
    }

    console.log(`Found ${employees.length} employees with SOCSO group S1\n`);

    let updated = 0;
    for (const employee of employees) {
        const rates = SOCSO_RATES['S1'];
        
        const { error } = await supabase
            .from('master_hr2000')
            .update({
                socso_employee: rates.employee,
                socso_employer: rates.employer,
                socso_group: 'S1',
                updated_at: new Date().toISOString()
            })
            .eq('employee_no', employee.employee_no);

        if (error) {
            console.error(`❌ Error updating ${employee.employee_no}:`, error.message);
        } else {
            console.log(`✅ Updated SOCSO rates for ${employee.employee_no}: Employee ${rates.employee}%, Employer ${rates.employer}%`);
            updated++;
        }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`Total records updated: ${updated}`);

    // Verify migration
    const { data: verifyData, error: verifyError } = await supabase
        .from('master_hr2000')
        .select('employee_no, socso_employee, socso_employer, socso_group')
        .not('socso_employee', 'is', null)
        .limit(10);

    if (!verifyError && verifyData) {
        console.log('\n✅ Sample migrated records:');
        verifyData.forEach(record => {
            console.log(`  ${record.employee_no}: Employee ${record.socso_employee}%, Employer ${record.socso_employer}% (Group: ${record.socso_group})`);
        });
    }
}

// Run migration
if (require.main === module) {
    migrateSocsoContributions().catch(console.error);
}

module.exports = { migrateSocsoContributions };