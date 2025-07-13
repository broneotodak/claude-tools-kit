#!/usr/bin/env node

/**
 * Create missing organizations and complete final mappings
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createMissingOrgs() {
    console.log('🏢 Creating Missing Organizations\n');
    console.log('=' .repeat(60) + '\n');
    
    // Get TODAK brand ID
    const { data: brands } = await supabase
        .from('thr_brands')
        .select('brand_id, name')
        .eq('name', 'TODAK')
        .single();
    
    const todakBrandId = brands?.brand_id;
    
    if (!todakBrandId) {
        console.error('❌ TODAK brand not found!');
        return;
    }
    
    console.log(`Found TODAK brand: ${todakBrandId}\n`);
    
    // Organizations to create
    const newOrgs = [
        {
            name: 'Todak Logistics Sdn Bhd',
            organization_code: 'TLSB',
            brand_id: todakBrandId,
            description: 'Logistics and transportation services'
        },
        {
            name: 'Camp Management Services',
            organization_code: 'CMS',
            brand_id: todakBrandId,
            description: 'Camp and facility management'
        }
    ];
    
    // Create organizations
    console.log('📝 Creating organizations:\n');
    
    for (const org of newOrgs) {
        console.log(`Creating ${org.name}...`);
        
        const { data, error } = await supabase
            .from('thr_organizations')
            .insert({
                name: org.name,
                organization_code: org.organization_code,
                brand_id: org.brand_id,
                is_active: true
            })
            .select()
            .single();
        
        if (error) {
            console.error(`  ❌ Error: ${error.message}`);
        } else {
            console.log(`  ✅ Created successfully with ID: ${data.organization_id}`);
        }
    }
    
    // Now map remaining employees
    console.log('\n\n🔄 Mapping remaining employees...\n');
    
    // Get all organizations again
    const { data: orgs } = await supabase
        .from('thr_organizations')
        .select('organization_id, organization_code');
    
    const orgMap = new Map();
    orgs?.forEach(org => {
        orgMap.set(org.organization_code, org.organization_id);
    });
    
    // Map TL employees to TLSB
    const tlsbOrgId = orgMap.get('TLSB');
    if (tlsbOrgId) {
        const { data: tlEmployees } = await supabase
            .from('thr_employees')
            .select('id, employee_no')
            .like('employee_no', 'TL%')
            .is('organization_id', null);
        
        if (tlEmployees && tlEmployees.length > 0) {
            console.log(`Mapping ${tlEmployees.length} TL employees to Todak Logistics...`);
            
            const { error } = await supabase
                .from('thr_employees')
                .update({ organization_id: tlsbOrgId })
                .in('id', tlEmployees.map(e => e.id));
            
            if (!error) {
                console.log('✅ TL employees mapped successfully\n');
            }
        }
    }
    
    // Map CMP employees to CMS
    const cmsOrgId = orgMap.get('CMS');
    if (cmsOrgId) {
        const { data: cmpEmployees } = await supabase
            .from('thr_employees')
            .select('id, employee_no')
            .like('employee_no', 'CMP%')
            .is('organization_id', null);
        
        if (cmpEmployees && cmpEmployees.length > 0) {
            console.log(`Mapping ${cmpEmployees.length} CMP employees to Camp Management Services...`);
            
            const { error } = await supabase
                .from('thr_employees')
                .update({ organization_id: cmsOrgId })
                .in('id', cmpEmployees.map(e => e.id));
            
            if (!error) {
                console.log('✅ CMP employees mapped successfully\n');
            }
        }
    }
    
    // Final check
    console.log('\n📊 Final Organization Mapping Status:\n');
    
    const { data: finalDist } = await supabase
        .from('thr_employees')
        .select('organization_id, thr_organizations!inner(name)')
        .not('organization_id', 'is', null);
    
    const orgCounts = {};
    finalDist?.forEach(emp => {
        const orgName = emp.thr_organizations?.name || 'Unknown';
        orgCounts[orgName] = (orgCounts[orgName] || 0) + 1;
    });
    
    // Sort by count
    const sortedOrgs = Object.entries(orgCounts)
        .sort((a, b) => b[1] - a[1]);
    
    console.log('Employee Distribution by Organization:');
    sortedOrgs.forEach(([org, count]) => {
        console.log(`  ${org}: ${count} employees`);
    });
    
    // Check if any still unmapped
    const { count: unmappedCount } = await supabase
        .from('thr_employees')
        .select('*', { count: 'exact', head: true })
        .is('organization_id', null);
    
    console.log(`\n📈 Summary:`);
    console.log(`  Total Employees: 518`);
    console.log(`  Mapped: ${518 - (unmappedCount || 0)}`);
    console.log(`  Unmapped: ${unmappedCount || 0}`);
    console.log(`  Success Rate: ${Math.round((518 - (unmappedCount || 0))/518*100)}%`);
    
    if (unmappedCount && unmappedCount > 0) {
        console.log('\n⚠️  Still unmapped employees:');
        const { data: stillUnmapped } = await supabase
            .from('thr_employees')
            .select('employee_no, full_name')
            .is('organization_id', null)
            .limit(10);
        
        stillUnmapped?.forEach(emp => {
            console.log(`  - ${emp.employee_no}: ${emp.full_name}`);
        });
    }
    
    console.log('\n✅ Organization mapping complete!');
    console.log('');
}

// Run
if (require.main === module) {
    createMissingOrgs().catch(console.error);
}

module.exports = { createMissingOrgs };