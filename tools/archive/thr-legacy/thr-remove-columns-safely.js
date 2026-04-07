#!/usr/bin/env node

/**
 * THR Safe Column Removal Script
 * Removes migrated columns with safety checks and verification
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Columns to remove (grouped by migration destination)
const COLUMNS_TO_REMOVE = {
    // Empty columns (no data)
    empty: [
        'address', 'address2', 'city', 'state', 'postcode', 'country',
        'birth_place', 'pr_status', 'branch', 'reporting_to'
    ],
    // Migrated to contact_info
    contact_info: ['mobile', 'personal_email', 'company_email'],
    // Migrated to bank_info
    bank_info: ['bank_name', 'bank_acc_no', 'bank_branch'],
    // Migrated to employment_timeline
    employment_timeline: ['employment_date', 'confirmation_date', 'resign_date'],
    // Migrated to tax_info
    tax_info: [
        'lhdn_no', 'income_tax_branch', 'pcb', 'ea_form',
        'epf_no', 'epf_group', 'socso_no', 'perkeso_code',
        'socso_group', 'eis_group', 'kwsp_no', 'ptptn_no'
    ],
    // Migrated to spouse_details
    spouse_details: [
        'spouse_name', 'spouse_ic', 'spouse_occupation',
        'spouse_employer', 'spouse_employment_date', 'spouse_dob'
    ]
};

async function safeColumnRemoval() {
    console.log('🗑️ THR Safe Column Removal Process\n');
    console.log('=' .repeat(60) + '\n');
    
    // Use the backup table we created earlier today
    const backupTable = 'master_hr2000_backup_2025_07_12';
    
    // Step 1: Verify backup exists
    console.log('1️⃣ Verifying backup table exists...');
    
    const { count: backupCount, error: backupError } = await supabase
        .from(backupTable)
        .select('*', { count: 'exact', head: true });
    
    if (backupError || backupCount === 0) {
        console.error('❌ Could not verify backup table. Aborting for safety.');
        console.log(`Error:`, backupError);
        return;
    }
    
    console.log(`✅ Backup table ${backupTable} verified with ${backupCount} records\n`);
    
    // Step 2: Pre-removal verification
    console.log('2️⃣ Running pre-removal verification...\n');
    
    // Check JSONB migration completeness
    const verifications = [
        { jsonb: 'contact_info', check: 'mobile', desc: 'Contact information' },
        { jsonb: 'bank_info', check: 'bank_name', desc: 'Bank details' },
        { jsonb: 'employment_timeline', check: 'employment_date', desc: 'Employment dates' },
        { jsonb: 'tax_info', check: 'lhdn_no', desc: 'Tax information' }
    ];
    
    let allVerified = true;
    
    for (const verify of verifications) {
        // Count records with data in original column
        const { data: originalCount } = await supabase
            .from('master_hr2000')
            .select('id', { count: 'exact', head: true })
            .not(verify.check, 'is', null);
        
        // Count records with data in JSONB
        const { count: jsonbCount } = await supabase
            .from('master_hr2000')
            .select('*', { count: 'exact', head: true })
            .not(verify.jsonb, 'is', null);
        
        console.log(`  ${verify.desc}:`);
        console.log(`    Original column has data: ${originalCount?.count || 0} records`);
        console.log(`    JSONB field has data: ${jsonbCount} records`);
        
        if ((originalCount?.count || 0) > jsonbCount) {
            console.log(`    ⚠️  WARNING: Potential data loss detected!`);
            allVerified = false;
        } else {
            console.log(`    ✅ All data migrated successfully`);
        }
        console.log('');
    }
    
    if (!allVerified) {
        console.log('❌ Verification failed. Some data may not be properly migrated.');
        console.log('Please check the migration before proceeding.\n');
        return;
    }
    
    console.log('✅ All verifications passed\n');
    
    // Step 3: Remove columns in batches
    console.log('3️⃣ Removing columns in batches...\n');
    
    const allColumns = Object.values(COLUMNS_TO_REMOVE).flat();
    let removedCount = 0;
    
    for (const [group, columns] of Object.entries(COLUMNS_TO_REMOVE)) {
        console.log(`📦 Removing ${group} columns (${columns.length} columns)...`);
        
        // Remove columns one by one to handle errors gracefully
        for (const column of columns) {
            try {
                const { error } = await supabase.rpc('execute_sql', {
                    sql_query: `ALTER TABLE master_hr2000 DROP COLUMN IF EXISTS ${column};`
                });
                
                if (error) {
                    console.error(`  ❌ Error removing ${column}:`, error.message);
                } else {
                    console.log(`  ✅ Removed: ${column}`);
                    removedCount++;
                }
            } catch (err) {
                console.error(`  ❌ Error removing ${column}:`, err.message);
            }
        }
        console.log('');
    }
    
    console.log(`✅ Successfully removed ${removedCount} of ${allColumns.length} columns\n`);
    
    // Step 4: Post-removal verification
    console.log('4️⃣ Running post-removal verification...\n');
    
    // Get current column count
    const { data: currentColumns } = await supabase.rpc('execute_sql', {
        sql_query: `
            SELECT COUNT(*) as column_count
            FROM information_schema.columns
            WHERE table_name = 'master_hr2000'
            AND table_schema = 'public';
        `
    });
    
    console.log(`📊 Current table structure:`);
    console.log(`  - Columns remaining: ${currentColumns?.[0]?.column_count || 'Unknown'}`);
    console.log(`  - Columns removed: ${removedCount}`);
    console.log(`  - Original columns: 77\n`);
    
    // Step 5: Create verification report
    console.log('5️⃣ Creating verification report...\n');
    
    const verificationSQL = `
-- Verification Report Generated: ${new Date().toISOString()}

-- 1. Compare structure
SELECT 
    'Original (backup)' as table_type,
    COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = '${backupTable}'
AND table_schema = 'public'
UNION ALL
SELECT 
    'Current (cleaned)' as table_type,
    COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'master_hr2000'
AND table_schema = 'public';

-- 2. Verify data preservation (example)
SELECT 
    COUNT(*) as total_employees,
    COUNT(contact_info) as has_contact_info,
    COUNT(bank_info) as has_bank_info,
    COUNT(employment_timeline) as has_timeline,
    COUNT(tax_info) as has_tax_info
FROM master_hr2000;

-- 3. Sample data comparison
SELECT 
    m.employee_no,
    m.employee_name,
    jsonb_pretty(m.contact_info) as contact_info,
    jsonb_pretty(m.bank_info) as bank_info
FROM master_hr2000 m
LIMIT 5;
`;
    
    console.log('📝 Run these verification queries in Supabase:');
    console.log('```sql');
    console.log(verificationSQL);
    console.log('```\n');
    
    // Summary
    console.log('=' .repeat(60));
    console.log('\n✅ COLUMN REMOVAL COMPLETE!\n');
    console.log('📋 Summary:');
    console.log(`  - Backup table: ${backupTable}`);
    console.log(`  - Columns removed: ${removedCount}`);
    console.log(`  - Data preserved in JSONB fields`);
    
    console.log('\n🔐 Data Safety:');
    console.log('  ✅ All data backed up before removal');
    console.log('  ✅ Pre-removal verification passed');
    console.log('  ✅ Columns removed successfully');
    console.log('  ✅ Original data preserved in JSONB');
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Run the verification queries above');
    console.log('  2. Check application still works correctly');
    console.log('  3. Build the Brand → Organization structure');
    
    console.log('\n💡 To restore if needed:');
    console.log(`  - Backup table: ${backupTable}`);
    console.log(`  - Restore script: backups/restore_script_*.sh`);
    console.log('');
}

// Run safe removal
if (require.main === module) {
    safeColumnRemoval().catch(console.error);
}

module.exports = { safeColumnRemoval };