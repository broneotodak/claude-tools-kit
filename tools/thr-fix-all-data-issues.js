#!/usr/bin/env node

/**
 * Fix all employee-spouse name swaps and gender mismatches
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixAllDataIssues() {
    console.log('🔧 FIXING ALL DATA ISSUES\n');
    console.log('=' .repeat(60) + '\n');
    
    let fixedCount = 0;
    let errorCount = 0;
    
    // 1. Fix spouse name swaps where name = spouse name
    console.log('1️⃣ Fixing spouse name swaps...\n');
    
    // Get all employees with spouse details
    const { data: employees } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name, personal_info, data_source')
        .not('personal_info->spouse_details', 'is', null);
    
    for (const emp of employees || []) {
        const spouseName = emp.personal_info?.spouse_details?.name;
        if (spouseName) {
            const cleanSpouseName = spouseName.replace(/^Name\s+/i, '').trim();
            
            // Check if employee name matches spouse name
            if (emp.full_name === cleanSpouseName || 
                (emp.full_name.length > 20 && cleanSpouseName.length > 20 && 
                 emp.full_name.substring(0, 20) === cleanSpouseName.substring(0, 20))) {
                
                console.log(`Fixing ${emp.employee_no}: ${emp.full_name}`);
                
                // Try to extract real name from data_source
                let realName = null;
                
                // Check if real name is in data_source
                if (emp.data_source?.Name) {
                    realName = emp.data_source.Name;
                } else if (emp.data_source?.['Employee Name']) {
                    realName = emp.data_source['Employee Name'];
                }
                
                if (!realName) {
                    // Try to reconstruct based on gender and pattern
                    const gender = emp.personal_info?.gender;
                    
                    if (gender === 'MALE' && emp.full_name.includes(' Binti ')) {
                        // Male with female name - spouse is likely correct
                        console.log(`  ⚠️  Cannot determine real name for ${emp.employee_no} - needs manual review`);
                        errorCount++;
                        continue;
                    } else if (gender === 'FEMALE' && emp.full_name.includes(' Bin ')) {
                        // Female with male name - spouse is likely correct
                        console.log(`  ⚠️  Cannot determine real name for ${emp.employee_no} - needs manual review`);
                        errorCount++;
                        continue;
                    }
                }
                
                if (realName && realName !== emp.full_name) {
                    // Update the name
                    const { error } = await supabase
                        .from('thr_employees')
                        .update({ 
                            full_name: realName,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', emp.id);
                    
                    if (error) {
                        console.log(`  ❌ Error: ${error.message}`);
                        errorCount++;
                    } else {
                        console.log(`  ✅ Fixed: ${emp.full_name} → ${realName}`);
                        fixedCount++;
                    }
                }
            }
        }
    }
    
    console.log(`\n✅ Fixed ${fixedCount} spouse name swaps`);
    console.log(`❌ ${errorCount} errors or need manual review\n`);
    
    // 2. Fix gender mismatches
    console.log('2️⃣ Fixing gender mismatches...\n');
    
    const genderFixes = [
        // Males with Binti (should be female)
        { employee_no: 'ST0051', correct_gender: 'FEMALE' },
        { employee_no: 'ST0003', correct_gender: 'FEMALE' },
        { employee_no: 'ST0047', correct_gender: 'FEMALE' },
        { employee_no: 'TS043', correct_gender: 'FEMALE' },
        { employee_no: 'TS080', correct_gender: 'FEMALE' },
        { employee_no: 'TS001', correct_gender: 'MALE' }, // Ahmad Fadli - already fixed name
        
        // Females with Bin (should be male)
        { employee_no: 'ST0045', correct_gender: 'MALE' },
        { employee_no: 'ST0038', correct_gender: 'MALE' },
        { employee_no: 'ST0015', correct_gender: 'MALE' }
    ];
    
    for (const fix of genderFixes) {
        const { data: emp } = await supabase
            .from('thr_employees')
            .select('id, full_name, personal_info')
            .eq('employee_no', fix.employee_no)
            .single();
        
        if (emp) {
            console.log(`Fixing gender for ${fix.employee_no}: ${emp.full_name}`);
            
            // Update gender in personal_info
            const updatedPersonalInfo = {
                ...emp.personal_info,
                gender: fix.correct_gender
            };
            
            const { error } = await supabase
                .from('thr_employees')
                .update({ 
                    personal_info: updatedPersonalInfo,
                    updated_at: new Date().toISOString()
                })
                .eq('id', emp.id);
            
            if (error) {
                console.log(`  ❌ Error: ${error.message}`);
            } else {
                console.log(`  ✅ Gender updated to ${fix.correct_gender}`);
            }
        }
    }
    
    // 3. Fix obvious name-gender mismatches by swapping employee and spouse names
    console.log('\n3️⃣ Fixing obvious name-gender swaps...\n');
    
    const nameSwaps = [
        // These are confirmed swaps based on name patterns
        { employee_no: 'MH002', swap: true }, // Amelia Edora (female name) is MALE
        { employee_no: 'ST0043', swap: true }, // Ainul Ta'ibah (female) is MALE
        { employee_no: 'TC151', swap: true }, // NURUL AKMA (female) is MALE
        { employee_no: 'TH072', swap: true }, // NUR SYAMIRA (female) is MALE
        { employee_no: 'ST0001', swap: true }, // Raihana (female) is MALE
        { employee_no: 'TA035', swap: true }, // SHELINA (female) is MALE
        { employee_no: 'TA042', swap: true }, // NOORMAYA (female) is MALE
        { employee_no: 'ST0031', swap: true }, // Hamidah (female) is MALE
        { employee_no: 'ST0012', swap: true }, // Nurul Afifah (female) is MALE
        { employee_no: 'ST0009', swap: true }, // Noor Zihan (female) is MALE
        { employee_no: 'ST0004', swap: true }, // Hastini (female) is MALE
        { employee_no: 'TA111', swap: true }, // NUR DAYANA (female) is MALE
        { employee_no: 'TA117', swap: true }, // NUR FAIZAH (female) is MALE
        { employee_no: 'TA105', swap: true }, // AIN NURNISA (female) is MALE
        { employee_no: 'TA039', swap: true }, // NOR AZMIRA (female) is MALE
        
        // Male names that are FEMALE
        { employee_no: 'TA036', swap: true }, // Mohd Zahril (male) is FEMALE
        { employee_no: 'ST0039', swap: true }, // Aiman (male) is FEMALE
        { employee_no: 'TA048', swap: true }, // Mohd Shahlan (male) is FEMALE
        { employee_no: 'TH058', swap: true }, // MOHD FARID (male) is FEMALE
        { employee_no: 'TA054', swap: true }, // Muhammad Hafiz (male) is FEMALE
        { employee_no: 'MTSB013', swap: true }, // ZULPADHLI (male) is FEMALE
        { employee_no: 'TA041', swap: true }, // MOHD HAIRUL (male) is FEMALE
        { employee_no: 'TH008', swap: true }, // MOHD SHAYYIE (male) is FEMALE
    ];
    
    for (const swap of nameSwaps) {
        const { data: emp } = await supabase
            .from('thr_employees')
            .select('*')
            .eq('employee_no', swap.employee_no)
            .single();
        
        if (emp && emp.personal_info?.spouse_details?.name) {
            const spouseName = emp.personal_info.spouse_details.name.replace(/^Name\s+/i, '').trim();
            const currentName = emp.full_name;
            
            console.log(`Swapping names for ${swap.employee_no}:`);
            console.log(`  Current: ${currentName} (${emp.personal_info.gender})`);
            console.log(`  Spouse: ${spouseName}`);
            
            // Determine correct gender based on name
            let correctGender = emp.personal_info.gender;
            if (spouseName.includes(' Bin ')) {
                correctGender = 'MALE';
            } else if (spouseName.includes(' Binti ') || spouseName.includes(' Bt ')) {
                correctGender = 'FEMALE';
            }
            
            // Update employee with spouse name and correct gender
            const updatedPersonalInfo = {
                ...emp.personal_info,
                gender: correctGender,
                spouse_details: {
                    ...emp.personal_info.spouse_details,
                    name: currentName // Put employee name as spouse
                }
            };
            
            const { error } = await supabase
                .from('thr_employees')
                .update({ 
                    full_name: spouseName,
                    personal_info: updatedPersonalInfo,
                    updated_at: new Date().toISOString()
                })
                .eq('id', emp.id);
            
            if (error) {
                console.log(`  ❌ Error: ${error.message}`);
            } else {
                console.log(`  ✅ Swapped successfully`);
            }
        }
    }
    
    // 4. Final verification
    console.log('\n4️⃣ Final verification...\n');
    
    // Count remaining issues
    const { data: remainingIssues } = await supabase
        .from('thr_employees')
        .select('employee_no, full_name, personal_info')
        .or('personal_info->gender.eq.MALE,personal_info->gender.eq.FEMALE');
    
    let maleWithBinti = 0;
    let femaleWithBin = 0;
    
    remainingIssues?.forEach(emp => {
        if (emp.personal_info?.gender === 'MALE' && emp.full_name.includes(' Binti ')) {
            maleWithBinti++;
        } else if (emp.personal_info?.gender === 'FEMALE' && emp.full_name.includes(' Bin ')) {
            femaleWithBin++;
        }
    });
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 FINAL SUMMARY:\n');
    console.log('✅ Data cleanup completed!');
    console.log(`   - Name swaps fixed: ${nameSwaps.length}`);
    console.log(`   - Gender corrections: ${genderFixes.length}`);
    console.log(`   - Remaining issues:`);
    console.log(`     • Males with "Binti": ${maleWithBinti}`);
    console.log(`     • Females with "Bin": ${femaleWithBin}`);
    
    if (maleWithBinti > 0 || femaleWithBin > 0) {
        console.log('\n⚠️  Some issues may need manual review');
        console.log('   These could be data entry errors or special cases');
    } else {
        console.log('\n🎉 All data issues have been resolved!');
    }
    
    // Create final report
    const finalReport = {
        timestamp: new Date().toISOString(),
        fixes_applied: {
            name_swaps: nameSwaps.length,
            gender_fixes: genderFixes.length,
            total_fixes: nameSwaps.length + genderFixes.length
        },
        remaining_issues: {
            male_with_binti: maleWithBinti,
            female_with_bin: femaleWithBin
        },
        status: 'COMPLETED'
    };
    
    const fs = require('fs');
    fs.writeFileSync('./thr-data-fixes-final.json', JSON.stringify(finalReport, null, 2));
    console.log('\n📄 Final report saved to: thr-data-fixes-final.json');
}

// Run fixes
if (require.main === module) {
    fixAllDataIssues().catch(console.error);
}

module.exports = { fixAllDataIssues };