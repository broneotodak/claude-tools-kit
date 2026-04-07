#!/usr/bin/env node

/**
 * Analyze and handle remaining unmapped employees
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeUnmapped() {
    console.log('🔍 Analyzing Unmapped Employees\n');
    console.log('=' .repeat(60) + '\n');
    
    // Get unmapped employees
    const { data: unmapped } = await supabase
        .from('thr_employees')
        .select('*')
        .is('organization_id', null)
        .order('employee_no');
    
    console.log(`Found ${unmapped?.length || 0} unmapped employees\n`);
    
    // Analyze prefixes
    const prefixAnalysis = {};
    unmapped?.forEach(emp => {
        const prefix = emp.employee_no.match(/^([A-Z]+)/)?.[1] || emp.employee_no.substring(0, 4);
        if (!prefixAnalysis[prefix]) {
            prefixAnalysis[prefix] = [];
        }
        prefixAnalysis[prefix].push(emp);
    });
    
    console.log('📊 Prefix Analysis:');
    Object.entries(prefixAnalysis)
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([prefix, emps]) => {
            console.log(`\n${prefix}: ${emps.length} employees`);
            emps.slice(0, 3).forEach(emp => {
                console.log(`  - ${emp.employee_no}: ${emp.full_name}`);
            });
            if (emps.length > 3) {
                console.log(`  ... and ${emps.length - 3} more`);
            }
        });
    
    // Check if we need to create new organizations
    console.log('\n\n🏢 Missing Organizations:');
    
    const missingOrgs = {
        'HYLN': 'Hyleen Sdn. Bhd. (Hotel/Hospitality)',
        'CMP': 'Camp/Company (needs clarification)',
        'TL': 'Todak Logistics/Transport (possibly)',
        'ST': 'Unknown - needs investigation',
        'CAMP': 'Camp related organization'
    };
    
    console.log('\nSuggested new organizations or mappings:');
    Object.entries(missingOrgs).forEach(([prefix, desc]) => {
        const count = prefixAnalysis[prefix]?.length || 0;
        if (count > 0) {
            console.log(`  ${prefix} → ${desc} (${count} employees)`);
        }
    });
    
    // Check master_hr2000 for more info
    console.log('\n\n📋 Checking master_hr2000 for organization info:');
    
    const empNos = unmapped?.map(e => e.employee_no) || [];
    const { data: masterInfo } = await supabase
        .from('master_hr2000')
        .select('employee_no, organization, department')
        .in('employee_no', empNos.slice(0, 20)); // Check first 20
    
    console.log('\nOrganization info from master data:');
    masterInfo?.forEach(info => {
        if (info.organization) {
            console.log(`  ${info.employee_no}: ${info.organization}`);
        }
    });
    
    // Suggest manual mappings
    console.log('\n\n🔧 Suggested Actions:');
    console.log('\n1. HYLN prefix employees (Hyleen):');
    console.log('   - These should map to HSB (Hyleen Sdn. Bhd.)');
    console.log('   - Organization already exists with code HSB');
    
    console.log('\n2. Create missing organizations:');
    console.log('   - Check if TL/ST/CMP organizations exist under different names');
    console.log('   - May need to create new organizations');
    
    console.log('\n3. Special cases:');
    console.log('   - Some employee numbers might be temporary or test data');
    console.log('   - Verify with business team');
    
    // Generate mapping for HYLN employees
    console.log('\n\n✅ Quick fix for HYLN employees:');
    const hylnCount = prefixAnalysis['HYLN']?.length || 0;
    if (hylnCount > 0) {
        console.log(`Found ${hylnCount} HYLN employees that should map to HSB (Hyleen Sdn. Bhd.)`);
    }
}

// Run analysis
if (require.main === module) {
    analyzeUnmapped().catch(console.error);
}

module.exports = { analyzeUnmapped };