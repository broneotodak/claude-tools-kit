#!/usr/bin/env node

/**
 * THR Database Backup Script
 * Creates a complete backup of master_hr2000 before column removal
 * Saves to both local JSON and creates a backup table
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createBackup() {
    console.log('🔒 THR Database Backup Process\n');
    console.log('=' .repeat(60) + '\n');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const backupTableName = `master_hr2000_backup_${timestamp.replace(/-/g, '_')}`;
    
    console.log(`📅 Backup Date: ${new Date().toISOString()}`);
    console.log(`📋 Backup Table: ${backupTableName}\n`);
    
    // Step 1: Create backup table in database
    console.log('1️⃣ Creating backup table in database...');
    
    const { error: createError } = await supabase.rpc('execute_sql', {
        sql_query: `
            -- Create backup table with exact same structure
            CREATE TABLE ${backupTableName} AS 
            SELECT * FROM master_hr2000;
            
            -- Add comment to identify backup
            COMMENT ON TABLE ${backupTableName} IS 
            'Backup of master_hr2000 before column cleanup on ${timestamp}';
        `
    });
    
    if (createError) {
        console.error('❌ Error creating backup table:', createError);
        return;
    }
    
    console.log('✅ Backup table created successfully\n');
    
    // Step 2: Export data to JSON file
    console.log('2️⃣ Exporting data to JSON file...');
    
    const { data: allData, error: fetchError } = await supabase
        .from('master_hr2000')
        .select('*')
        .order('employee_no');
    
    if (fetchError) {
        console.error('❌ Error fetching data:', fetchError);
        return;
    }
    
    // Create backup directory
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Save full backup
    const backupFile = path.join(backupDir, `master_hr2000_backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
        backup_info: {
            table: 'master_hr2000',
            date: new Date().toISOString(),
            total_records: allData.length,
            columns: Object.keys(allData[0] || {}).length,
            backup_table: backupTableName
        },
        data: allData
    }, null, 2));
    
    console.log(`✅ Data exported to: ${backupFile}`);
    console.log(`   Total records: ${allData.length}\n`);
    
    // Step 3: Create column mapping reference
    console.log('3️⃣ Creating column mapping reference...');
    
    const columnMapping = {
        removed_columns: {
            contact_info: ['mobile', 'personal_email', 'company_email', 'address', 'address2', 'city', 'state', 'postcode', 'country'],
            bank_info: ['bank_name', 'bank_acc_no', 'bank_branch'],
            employment_timeline: ['employment_date', 'confirmation_date', 'resign_date'],
            tax_info: ['lhdn_no', 'income_tax_branch', 'pcb', 'ea_form', 'epf_no', 'epf_group', 'socso_no', 'perkeso_code', 'socso_group', 'eis_group', 'kwsp_no', 'ptptn_no'],
            spouse_details: ['spouse_name', 'spouse_ic', 'spouse_occupation', 'spouse_employer', 'spouse_employment_date', 'spouse_dob'],
            empty_columns: ['birth_place', 'pr_status', 'branch', 'reporting_to']
        },
        jsonb_fields: {
            new: ['contact_info', 'bank_info', 'employment_timeline', 'tax_info'],
            existing: ['spouse_details', 'fixed_allowances', 'allowances', 'deductions', 'statutory_deductions']
        }
    };
    
    const mappingFile = path.join(backupDir, `column_mapping_${timestamp}.json`);
    fs.writeFileSync(mappingFile, JSON.stringify(columnMapping, null, 2));
    console.log(`✅ Column mapping saved to: ${mappingFile}\n`);
    
    // Step 4: Create verification queries
    console.log('4️⃣ Generating verification queries...\n');
    
    const verificationQueries = `
-- Verification Queries for Backup ${timestamp}
-- Run these after column removal to ensure data integrity

-- 1. Compare record counts
SELECT 
    '${backupTableName}' as table_name, 
    COUNT(*) as record_count 
FROM ${backupTableName}
UNION ALL
SELECT 
    'master_hr2000' as table_name, 
    COUNT(*) as record_count 
FROM master_hr2000;

-- 2. Verify JSONB data preservation (example for contact_info)
SELECT 
    m.employee_no,
    m.contact_info->>'mobile' as new_mobile,
    b.mobile as old_mobile,
    CASE 
        WHEN m.contact_info->>'mobile' = b.mobile THEN 'MATCH'
        WHEN b.mobile IS NULL THEN 'WAS_NULL'
        ELSE 'MISMATCH'
    END as status
FROM master_hr2000 m
JOIN ${backupTableName} b ON m.id = b.id
WHERE b.mobile IS NOT NULL
LIMIT 10;

-- 3. Check for any data loss
SELECT 
    COUNT(*) as employees_with_potential_data_loss
FROM ${backupTableName} b
LEFT JOIN master_hr2000 m ON b.id = m.id
WHERE m.id IS NULL;
`;
    
    const verifyFile = path.join(backupDir, `verification_queries_${timestamp}.sql`);
    fs.writeFileSync(verifyFile, verificationQueries);
    console.log(`✅ Verification queries saved to: ${verifyFile}\n`);
    
    // Step 5: Create restore script
    console.log('5️⃣ Creating restore script...\n');
    
    const restoreScript = `#!/bin/bash
# Restore script for THR database
# Created: ${new Date().toISOString()}

echo "⚠️  WARNING: This will restore master_hr2000 from backup ${backupTableName}"
echo "All current data in master_hr2000 will be replaced!"
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled."
    exit 1
fi

# SQL to restore from backup
# Set these environment variables before running:
# export DATABASE_URL="your_database_connection_string"
psql "$DATABASE_URL" -c "
-- Create temporary table with current structure
CREATE TABLE master_hr2000_temp AS SELECT * FROM master_hr2000 LIMIT 0;

-- Drop current table
DROP TABLE master_hr2000;

-- Recreate from backup
CREATE TABLE master_hr2000 AS SELECT * FROM ${backupTableName};

-- Restore any missing constraints, indexes, etc.
-- Add them here based on your schema
"

echo "✅ Restore complete!"
`;
    
    const restoreFile = path.join(backupDir, `restore_script_${timestamp}.sh`);
    fs.writeFileSync(restoreFile, restoreScript);
    fs.chmodSync(restoreFile, '755'); // Make executable
    console.log(`✅ Restore script saved to: ${restoreFile}\n`);
    
    // Summary
    console.log('=' .repeat(60));
    console.log('\n✅ BACKUP COMPLETE!\n');
    console.log('📦 Backup Summary:');
    console.log(`  1. Database backup table: ${backupTableName}`);
    console.log(`  2. JSON backup file: ${backupFile}`);
    console.log(`  3. Column mapping: ${mappingFile}`);
    console.log(`  4. Verification queries: ${verifyFile}`);
    console.log(`  5. Restore script: ${restoreFile}`);
    
    console.log('\n🔐 Backup Statistics:');
    console.log(`  - Total records backed up: ${allData.length}`);
    console.log(`  - Total columns: ${Object.keys(allData[0] || {}).length}`);
    console.log(`  - Backup size: ${(fs.statSync(backupFile).size / 1024 / 1024).toFixed(2)} MB`);
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Verify the backup table exists in Supabase');
    console.log('  2. Check the JSON backup file');
    console.log('  3. Run the column removal SQL');
    console.log('  4. Use verification queries to ensure data integrity');
    
    console.log('\n⚠️  IMPORTANT: Keep these backup files safe!');
    console.log('They contain all employee data including sensitive information.\n');
}

// Run backup
if (require.main === module) {
    createBackup().catch(console.error);
}

module.exports = { createBackup };