#!/usr/bin/env node

/**
 * THR Database Cleanup Summary
 * Shows consolidated data and columns ready for removal
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function showCleanupSummary() {
    console.log('📊 THR Database Cleanup Summary\n');
    console.log('=' .repeat(60) + '\n');
    
    // Check JSONB consolidations
    console.log('✅ JSONB Consolidations Complete:\n');
    
    const jsonbChecks = [
        { field: 'contact_info', desc: 'Contact Information (email, phone, address)' },
        { field: 'bank_info', desc: 'Banking Details (account, payment info)' },
        { field: 'employment_timeline', desc: 'Employment Dates & Status' },
        { field: 'tax_info', desc: 'Tax & Statutory Information' },
        { field: 'spouse_details', desc: 'Spouse Information (from migration)' },
        { field: 'fixed_allowances', desc: 'Allowances & Deductions (from migration)' },
        { field: 'allowances', desc: 'Active Allowances (from migration)' }
    ];
    
    for (const check of jsonbChecks) {
        const { count } = await supabase
            .from('master_hr2000')
            .select('*', { count: 'exact', head: true })
            .not(check.field, 'is', null);
        
        console.log(`  ${check.field}: ${count} records`);
        console.log(`    → ${check.desc}`);
    }
    
    // List columns to remove
    console.log('\n\n🗑️ Columns Ready for Removal:\n');
    
    console.log('1. Empty Columns (no data):');
    const emptyColumns = [
        'address', 'address2', 'city', 'state', 'postcode', 'country',
        'birth_place', 'pr_status', 'branch', 'reporting_to'
    ];
    console.log(`   ${emptyColumns.join(', ')}`);
    
    console.log('\n2. Migrated to contact_info:');
    const contactColumns = ['mobile', 'personal_email', 'company_email'];
    console.log(`   ${contactColumns.join(', ')}`);
    
    console.log('\n3. Migrated to bank_info:');
    const bankColumns = ['bank_name', 'bank_acc_no', 'bank_branch'];
    console.log(`   ${bankColumns.join(', ')}`);
    
    console.log('\n4. Migrated to employment_timeline:');
    const timelineColumns = ['employment_date', 'confirmation_date', 'resign_date'];
    console.log(`   ${timelineColumns.join(', ')}`);
    
    console.log('\n5. Migrated to tax_info:');
    const taxColumns = [
        'lhdn_no', 'income_tax_branch', 'pcb', 'ea_form',
        'epf_no', 'epf_group', 'socso_no', 'perkeso_code',
        'socso_group', 'eis_group', 'kwsp_no', 'ptptn_no'
    ];
    console.log(`   ${taxColumns.join(', ')}`);
    
    console.log('\n6. Migrated to spouse_details JSONB:');
    const spouseColumns = [
        'spouse_name', 'spouse_ic', 'spouse_occupation',
        'spouse_employer', 'spouse_employment_date', 'spouse_dob'
    ];
    console.log(`   ${spouseColumns.join(', ')}`);
    
    // Total columns to remove
    const allColumnsToRemove = [
        ...emptyColumns,
        ...contactColumns,
        ...bankColumns,
        ...timelineColumns,
        ...taxColumns,
        ...spouseColumns
    ];
    
    console.log(`\n\n📈 Summary Statistics:`);
    console.log(`  - Current columns: 73`);
    console.log(`  - Columns to remove: ${allColumnsToRemove.length}`);
    console.log(`  - Remaining columns: ${73 - allColumnsToRemove.length}`);
    console.log(`  - Space reduction: ~${Math.round(allColumnsToRemove.length / 73 * 100)}%`);
    
    // Generate SQL for column removal
    console.log('\n\n🔧 SQL to Remove All Migrated Columns:\n');
    console.log('```sql');
    console.log('-- WARNING: Run this only after verifying all data is preserved in JSONB columns');
    console.log('-- BACKUP YOUR DATABASE FIRST!\n');
    console.log('ALTER TABLE master_hr2000');
    
    allColumnsToRemove.forEach((col, idx) => {
        const isLast = idx === allColumnsToRemove.length - 1;
        console.log(`DROP COLUMN ${col}${isLast ? ';' : ','}`);
    });
    console.log('```');
    
    // Show remaining structure
    console.log('\n\n✨ Optimized Table Structure (After Cleanup):\n');
    console.log('Core Fields:');
    console.log('  - id, employee_no, employee_name, organization_id');
    console.log('\nStatus Fields:');
    console.log('  - active_status, data_source');
    console.log('\nOrganizational Fields:');
    console.log('  - department, section, designation, grade, staff_category');
    console.log('\nDemographic Fields:');
    console.log('  - ic_no, date_of_birth, gender, race, religion, marital_status, nationality, citizen');
    console.log('\nCompensation Fields:');
    console.log('  - basic_salary, total_allowance, total_deduction, net_salary');
    console.log('  - kwsp_employer, kwsp_employee, eis_employer, eis_employee');
    console.log('  - socso_employer, socso_employee');
    console.log('\nJSONB Fields:');
    console.log('  - contact_info, bank_info, employment_timeline, tax_info');
    console.log('  - spouse_details, fixed_allowances, allowances, deductions');
    console.log('  - statutory_deductions');
    console.log('\nSystem Fields:');
    console.log('  - created_at, updated_at');
    
    console.log('\n' + '=' .repeat(60));
    console.log('\n✅ Cleanup analysis complete!\n');
}

// Run summary
if (require.main === module) {
    showCleanupSummary().catch(console.error);
}

module.exports = { showCleanupSummary };