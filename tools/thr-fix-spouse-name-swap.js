#!/usr/bin/env node

/**
 * Fix critical data issue where employee names got swapped with spouse names
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixSpouseNameSwap() {
    console.log('🚨 CRITICAL: Fixing Employee-Spouse Name Swap Issue\n');
    console.log('=' .repeat(60) + '\n');
    
    // First, fix Ahmad Fadli's name immediately
    console.log('1️⃣ Fixing Ahmad Fadli\'s record...\n');
    
    const ahmadFadliId = 'f221e445-ac90-4417-852b-ab76d792bd0c';
    
    // Update Ahmad Fadli's name
    const { error: updateError } = await supabase
        .from('thr_employees')
        .update({ 
            full_name: 'Ahmad Fadli Bin Ahmad Dahlan',
            updated_at: new Date().toISOString(),
            updated_by: 'SYSTEM_FIX'
        })
        .eq('id', ahmadFadliId);
    
    if (updateError) {
        console.error('❌ Error updating Ahmad Fadli:', updateError);
    } else {
        console.log('✅ Ahmad Fadli\'s name corrected!\n');
    }
    
    // Now check for similar issues
    console.log('2️⃣ Checking for similar spouse name swap issues...\n');
    
    // Get all employees with spouse details
    const { data: employees } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name, personal_info')
        .not('personal_info->spouse_details', 'is', null);
    
    const suspiciousRecords = [];
    
    employees?.forEach(emp => {
        const spouseName = emp.personal_info?.spouse_details?.name;
        if (spouseName) {
            // Clean up spouse name (remove "Name " prefix)
            const cleanSpouseName = spouseName.replace(/^Name\s+/i, '');
            
            // Check if employee name matches spouse name pattern
            if (emp.full_name === cleanSpouseName || 
                emp.full_name.includes(cleanSpouseName) ||
                cleanSpouseName.includes(emp.full_name)) {
                suspiciousRecords.push({
                    id: emp.id,
                    employee_no: emp.employee_no,
                    current_name: emp.full_name,
                    spouse_name: cleanSpouseName,
                    gender: emp.personal_info?.gender
                });
            }
        }
    });
    
    if (suspiciousRecords.length > 0) {
        console.log(`⚠️  Found ${suspiciousRecords.length} suspicious records:\n`);
        suspiciousRecords.forEach(rec => {
            console.log(`${rec.employee_no}: ${rec.current_name}`);
            console.log(`  Gender: ${rec.gender}`);
            console.log(`  Spouse: ${rec.spouse_name}`);
            console.log(`  Possible swap? ${rec.current_name === rec.spouse_name ? '🚨 YES' : 'Maybe'}\n`);
        });
    } else {
        console.log('✅ No other obvious spouse name swaps detected\n');
    }
    
    // Check gender mismatches (male with "Binti" or female with "Bin")
    console.log('3️⃣ Checking for gender-name mismatches...\n');
    
    const { data: allEmployees } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name, personal_info')
        .eq('employment_status', 'active');
    
    const genderMismatches = [];
    
    allEmployees?.forEach(emp => {
        const name = emp.full_name;
        const gender = emp.personal_info?.gender;
        
        // Check for mismatches
        if (gender === 'MALE' && (name.includes(' Binti ') || name.includes(' Bt '))) {
            genderMismatches.push({
                ...emp,
                issue: 'Male with "Binti" in name'
            });
        } else if (gender === 'FEMALE' && name.includes(' Bin ')) {
            genderMismatches.push({
                ...emp,
                issue: 'Female with "Bin" in name'
            });
        }
    });
    
    if (genderMismatches.length > 0) {
        console.log(`⚠️  Found ${genderMismatches.length} gender-name mismatches:\n`);
        genderMismatches.forEach(emp => {
            console.log(`${emp.employee_no}: ${emp.full_name}`);
            console.log(`  Issue: ${emp.issue}`);
            console.log(`  Gender in DB: ${emp.personal_info?.gender}\n`);
        });
    } else {
        console.log('✅ No gender-name mismatches found\n');
    }
    
    // Create audit report
    console.log('4️⃣ Creating audit report...\n');
    
    const auditData = {
        timestamp: new Date().toISOString(),
        issue: 'Employee-Spouse Name Swap',
        fixed_records: [{
            id: ahmadFadliId,
            employee_no: 'TS001',
            old_name: 'Rodhiah Azzahra Binti Abu Hanifah',
            new_name: 'Ahmad Fadli Bin Ahmad Dahlan',
            status: 'FIXED'
        }],
        suspicious_records: suspiciousRecords,
        gender_mismatches: genderMismatches
    };
    
    // Save audit report
    const fs = require('fs');
    const reportPath = './thr-name-swap-audit.json';
    fs.writeFileSync(reportPath, JSON.stringify(auditData, null, 2));
    console.log(`📄 Audit report saved to: ${reportPath}\n`);
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 SUMMARY:\n');
    console.log(`✅ Fixed: Ahmad Fadli's name corrected`);
    console.log(`⚠️  Suspicious records found: ${suspiciousRecords.length}`);
    console.log(`⚠️  Gender mismatches found: ${genderMismatches.length}\n`);
    
    if (suspiciousRecords.length > 0 || genderMismatches.length > 0) {
        console.log('🔍 RECOMMENDED ACTIONS:');
        console.log('1. Review the audit report (thr-name-swap-audit.json)');
        console.log('2. Manually verify suspicious records');
        console.log('3. Check original HR2000 data for correct names');
        console.log('4. Run data validation before going to production\n');
    }
    
    // Verify Ahmad Fadli's fix
    const { data: verified } = await supabase
        .from('thr_employees')
        .select('full_name')
        .eq('id', ahmadFadliId)
        .single();
    
    console.log('✅ Verification: Ahmad Fadli\'s name is now:', verified?.full_name);
}

// Run fix
if (require.main === module) {
    fixSpouseNameSwap().catch(console.error);
}

module.exports = { fixSpouseNameSwap };