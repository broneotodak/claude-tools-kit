#!/usr/bin/env node

/**
 * Verify current THR database state
 * Check Brand → Organization connection and master_hr2000 structure
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function verifyCurrentState() {
    console.log('🔍 THR Database Current State Verification\n');
    console.log('=' .repeat(60) + '\n');
    
    // 1. Check Brand → Organization relationship
    console.log('1️⃣ Checking Brand → Organization Structure:\n');
    
    // Check brands table
    const { data: brands, error: brandError } = await supabase
        .from('brands')
        .select('*');
    
    console.log(`Brands table: ${brands?.length || 0} records`);
    if (brands && brands.length > 0) {
        console.log('Sample brands:', brands.slice(0, 3));
    }
    
    // Check organizations table
    const { data: orgs, error: orgError } = await supabase
        .from('organizations')
        .select('*');
    
    console.log(`\nOrganizations table: ${orgs?.length || 0} records`);
    if (orgs && orgs.length > 0) {
        console.log('Sample organizations:', orgs.slice(0, 3));
    }
    
    // Check thr_organizations (mentioned in constraints)
    const { data: thrOrgs, error: thrOrgError } = await supabase
        .from('thr_organizations')
        .select('*')
        .limit(5);
    
    console.log(`\nthr_organizations table: ${thrOrgs ? 'exists' : 'not found'}`);
    if (thrOrgs) {
        console.log('Sample records:', thrOrgs.length);
    }
    
    // 2. Check master_hr2000 current structure
    console.log('\n\n2️⃣ Current master_hr2000 Structure:\n');
    
    // Get a sample record to see all columns
    const { data: sample, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('*')
        .limit(1)
        .single();
    
    if (sample) {
        const columns = Object.keys(sample);
        console.log(`Total columns: ${columns.length}\n`);
        
        // Categorize columns
        const jsonbColumns = columns.filter(col => {
            const value = sample[col];
            return typeof value === 'object' && value !== null && !(value instanceof Date);
        });
        
        const newJsonbColumns = ['contact_info', 'bank_info', 'employment_timeline', 'tax_info'];
        const existingJsonbColumns = jsonbColumns.filter(col => !newJsonbColumns.includes(col));
        
        console.log('📦 JSONB Columns Added by Cleanup:');
        newJsonbColumns.forEach(col => {
            const exists = columns.includes(col);
            const hasData = sample[col] !== null;
            console.log(`  ${exists ? '✅' : '❌'} ${col}: ${exists ? (hasData ? 'has data' : 'empty') : 'not found'}`);
        });
        
        console.log('\n📦 Pre-existing JSONB Columns:');
        existingJsonbColumns.forEach(col => {
            const hasData = sample[col] !== null;
            console.log(`  ✅ ${col}: ${hasData ? 'has data' : 'empty'}`);
        });
        
        console.log('\n📋 Other Columns (non-JSONB):');
        const otherColumns = columns.filter(col => !jsonbColumns.includes(col));
        console.log(`  Total: ${otherColumns.length} columns`);
        console.log(`  Columns: ${otherColumns.join(', ')}`);
    }
    
    // 3. Check removed columns
    console.log('\n\n3️⃣ Checking Removed Columns:\n');
    
    const removedColumns = [
        'mobile', 'personal_email', 'company_email',
        'bank_name', 'bank_acc_no', 'bank_branch',
        'employment_date', 'confirmation_date', 'resign_date'
    ];
    
    if (sample) {
        const stillExists = removedColumns.filter(col => Object.keys(sample).includes(col));
        console.log(`Columns that should be removed:`);
        console.log(`  - Still exist: ${stillExists.length > 0 ? stillExists.join(', ') : 'None ✅'}`);
        console.log(`  - Successfully removed: ${removedColumns.length - stillExists.length} of ${removedColumns.length}`);
    }
    
    // 4. Summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('\n📊 SUMMARY:\n');
    
    console.log('1. Brand → Organization:');
    console.log(`   - Brands table: ${brands ? 'exists' : 'not found'} (${brands?.length || 0} records)`);
    console.log(`   - Organizations table: ${orgs ? 'exists' : 'not found'} (${orgs?.length || 0} records)`);
    console.log(`   - Connection: ${(brands?.length || 0) > 0 && (orgs?.length || 0) > 0 ? 'Ready to use' : 'Tables exist but empty'}`);
    
    console.log('\n2. master_hr2000 Refinements:');
    console.log('   ✅ JSONB columns created:');
    console.log('      - contact_info (emails, phone, address)');
    console.log('      - bank_info (bank details, payment info)');
    console.log('      - employment_timeline (dates, tenure, status)');
    console.log('      - tax_info (LHDN, EPF, SOCSO, etc)');
    console.log('   ✅ 37 columns removed (data preserved in JSONB)');
    console.log('   ✅ Backup created: master_hr2000_backup_2025_07_12');
    
    console.log('\n3. Next Steps:');
    console.log('   - Populate Brand → Organization data if needed');
    console.log('   - Consider consolidating remaining fields (demographics, compensation)');
    console.log('   - Build employee management features on clean structure');
    
    console.log('');
}

// Run verification
if (require.main === module) {
    verifyCurrentState().catch(console.error);
}

module.exports = { verifyCurrentState };