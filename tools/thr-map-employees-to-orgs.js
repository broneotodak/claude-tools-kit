#!/usr/bin/env node

/**
 * Map employees to their correct organizations based on employee number prefixes
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function mapEmployeesToOrgs() {
    console.log('🏢 Mapping Employees to Organizations\n');
    console.log('=' .repeat(60) + '\n');
    
    // Step 1: Get all organizations
    const { data: orgs } = await supabase
        .from('thr_organizations')
        .select('*');
    
    // Create lookup map by organization_code
    const orgMap = new Map();
    orgs?.forEach(org => {
        orgMap.set(org.organization_code, org.organization_id);
    });
    
    console.log('📋 Available Organizations:');
    orgs?.forEach(org => {
        console.log(`  ${org.organization_code} → ${org.name}`);
    });
    
    // Step 2: Get unmapped employees
    console.log('\n\n🔍 Analyzing Unmapped Employees...\n');
    
    const { data: employees } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name, organization_id')
        .is('organization_id', null);
    
    console.log(`Found ${employees?.length || 0} unmapped employees\n`);
    
    // Step 3: Create mapping rules based on employee prefixes
    const mappingRules = {
        // Direct organization code matches
        'LTCM': 'LTCM',  // Lan Todak Consultation & Management
        'TTK': 'TTK',    // Tadika Todak Kids (but might be Todak Trading)
        'TASB': 'TASB',  // Todak Academy Sdn. Bhd.
        'TCSB': 'TCSB',  // Todak Culture Sdn. Bhd.
        'TDSB': 'TDSB',  // Todak Digitech Sdn. Bhd.
        'THSB': 'THSB',  // Todak Holdings Sdn. Bhd.
        'TPSB': 'TPSB',  // Todak Paygate Sdn. Bhd.
        'TRC': 'TRC',    // Todak RC Enterprise
        'TSSB': 'TSSB',  // Todak Studios Sdn. Bhd.
        'MTSB': 'MTSB',  // My Barber Tech Sdn. Bhd.
        'STSB': 'STSB',  // Sarcom Technology Sdn. Bhd.
        '10C': '10C',    // 10 Camp Enterprise
        'MH': 'MH',      // Muscle Hub
        'HSB': 'HSB',    // Hyleen Sdn. Bhd.
        
        // Common prefixes that need special handling
        'TC': 'TCSB',    // TC prefix → Todak Culture (most likely)
        'TS': 'TSSB',    // TS prefix → Todak Studios (most likely)
        'TA': 'TASB',    // TA prefix → Todak Academy
        'TH': 'THSB',    // TH prefix → Todak Holdings
        'TD': 'TDSB',    // TD prefix → Todak Digitech
        'TP': 'TPSB',    // TP prefix → Todak Paygate
        'TG': 'TG',      // TG prefix → Kelab Sukan Elektronik Todak
    };
    
    // Step 4: Map employees
    console.log('🔄 Mapping employees to organizations...\n');
    
    const updates = [];
    const unmapped = [];
    
    for (const emp of employees || []) {
        let mapped = false;
        
        // Try to extract prefix from employee number
        const empNo = emp.employee_no.toUpperCase();
        
        // First try exact match with full prefix
        for (const [prefix, orgCode] of Object.entries(mappingRules)) {
            if (empNo.startsWith(prefix)) {
                const orgId = orgMap.get(orgCode);
                if (orgId) {
                    updates.push({
                        id: emp.id,
                        employee_no: emp.employee_no,
                        organization_id: orgId,
                        organization_code: orgCode
                    });
                    mapped = true;
                    break;
                }
            }
        }
        
        if (!mapped) {
            unmapped.push(emp);
        }
    }
    
    console.log(`📊 Mapping Results:`);
    console.log(`  - Can be mapped: ${updates.length}`);
    console.log(`  - Cannot be mapped: ${unmapped.length}\n`);
    
    // Show mapping preview
    console.log('📋 Mapping Preview (first 10):');
    updates.slice(0, 10).forEach(update => {
        const org = orgs?.find(o => o.organization_id === update.organization_id);
        console.log(`  ${update.employee_no} → ${org?.name || 'Unknown'}`);
    });
    
    if (unmapped.length > 0) {
        console.log('\n⚠️  Unmapped Employees (first 10):');
        unmapped.slice(0, 10).forEach(emp => {
            console.log(`  ${emp.employee_no} - ${emp.full_name}`);
        });
    }
    
    // Step 5: Apply updates
    console.log('\n\n🚀 Applying updates...\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    // Update in batches
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        
        for (const update of batch) {
            const { error } = await supabase
                .from('thr_employees')
                .update({ organization_id: update.organization_id })
                .eq('id', update.id);
            
            if (error) {
                console.error(`❌ Error updating ${update.employee_no}:`, error.message);
                errorCount++;
            } else {
                successCount++;
            }
        }
        
        // Progress indicator
        console.log(`Progress: ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
    }
    
    // Step 6: Final summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('\n✅ MAPPING COMPLETE!\n');
    
    console.log(`📊 Results:`);
    console.log(`  - Successfully mapped: ${successCount}`);
    console.log(`  - Errors: ${errorCount}`);
    console.log(`  - Still unmapped: ${unmapped.length}`);
    
    // Verify final distribution
    const { data: finalDist } = await supabase
        .from('thr_employees')
        .select('organization_id');
    
    const orgCounts = {};
    finalDist?.forEach(emp => {
        const orgId = emp.organization_id || 'unmapped';
        orgCounts[orgId] = (orgCounts[orgId] || 0) + 1;
    });
    
    console.log('\n📊 Final Distribution:');
    for (const [orgId, count] of Object.entries(orgCounts)) {
        if (orgId === 'unmapped') {
            console.log(`  Unmapped: ${count} employees`);
        } else {
            const org = orgs?.find(o => o.organization_id === orgId);
            console.log(`  ${org?.name || 'Unknown'}: ${count} employees`);
        }
    }
    
    console.log('\n💡 Notes:');
    console.log('  - Mapping based on employee number prefixes');
    console.log('  - Some organizations might need manual verification');
    console.log('  - TTK could be "Tadika Todak Kids" or "Todak Trading"');
    
    console.log('');
}

// Run mapping
if (require.main === module) {
    mapEmployeesToOrgs().catch(console.error);
}

module.exports = { mapEmployeesToOrgs };