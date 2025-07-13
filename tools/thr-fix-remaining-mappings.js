#!/usr/bin/env node

/**
 * Fix remaining organization mappings
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixRemainingMappings() {
    console.log('🔧 Fixing Remaining Organization Mappings\n');
    console.log('=' .repeat(60) + '\n');
    
    // Get organization map
    const { data: orgs } = await supabase
        .from('thr_organizations')
        .select('*');
    
    const orgMap = new Map();
    orgs?.forEach(org => {
        orgMap.set(org.organization_code, org.organization_id);
    });
    
    // Step 1: Fix HYLN employees
    console.log('1️⃣ Fixing HYLN employees (should be HSB)...\n');
    
    const hsbOrgId = orgMap.get('HSB');
    if (hsbOrgId) {
        const { data: hylnEmployees } = await supabase
            .from('thr_employees')
            .select('id, employee_no')
            .like('employee_no', 'HYLN%')
            .is('organization_id', null);
        
        console.log(`Found ${hylnEmployees?.length || 0} HYLN employees to map to HSB`);
        
        if (hylnEmployees && hylnEmployees.length > 0) {
            const { error } = await supabase
                .from('thr_employees')
                .update({ organization_id: hsbOrgId })
                .in('id', hylnEmployees.map(e => e.id));
            
            if (error) {
                console.error('Error updating HYLN employees:', error);
            } else {
                console.log(`✅ Mapped ${hylnEmployees.length} HYLN employees to Hyleen Sdn. Bhd.\n`);
            }
        }
    }
    
    // Step 2: Check for missing organizations we should create
    console.log('2️⃣ Checking for missing organizations...\n');
    
    // Based on raw data files, we're missing some organizations
    const missingOrgs = [
        {
            name: 'Todak 10 Corner Sdn Bhd',
            organization_code: '10CORNER',
            brand_name: 'TODAK',
            notes: 'For 10C prefix employees (if different from 10 Camp)'
        },
        {
            name: 'Todak Logistics Sdn Bhd',
            organization_code: 'TLSB',
            brand_name: 'TODAK',
            notes: 'For TL prefix employees'
        },
        {
            name: 'Sarcom Technology Services',
            organization_code: 'STS',
            brand_name: 'Sarcom',
            notes: 'For ST prefix employees (Sarcom subsidiary)'
        },
        {
            name: 'Camp Management Services',
            organization_code: 'CMS',
            brand_name: 'TODAK',
            notes: 'For CMP prefix employees'
        },
        {
            name: 'Todak Kids Centre',
            organization_code: 'TKC',
            brand_name: 'TODAK',
            notes: 'For TK prefix employees (different from TTK)'
        }
    ];
    
    console.log('Suggested organizations to create:');
    missingOrgs.forEach(org => {
        console.log(`\n${org.organization_code}: ${org.name}`);
        console.log(`  Brand: ${org.brand_name}`);
        console.log(`  Notes: ${org.notes}`);
    });
    
    // Step 3: Create SQL for missing organizations
    console.log('\n\n3️⃣ SQL to create missing organizations:\n');
    
    // Get brand IDs
    const { data: brands } = await supabase
        .from('thr_brands')
        .select('brand_id, name');
    
    const brandMap = new Map();
    brands?.forEach(brand => {
        brandMap.set(brand.name, brand.brand_id);
    });
    
    console.log('```sql');
    console.log('-- Insert missing organizations');
    missingOrgs.forEach(org => {
        const brandId = brandMap.get(org.brand_name);
        if (brandId) {
            console.log(`INSERT INTO thr_organizations (name, organization_code, brand_id, is_active)`);
            console.log(`VALUES ('${org.name}', '${org.organization_code}', '${brandId}', true);`);
            console.log('');
        }
    });
    console.log('```');
    
    // Step 4: Show final unmapped analysis
    console.log('\n\n4️⃣ Final Unmapped Analysis:\n');
    
    const { data: stillUnmapped } = await supabase
        .from('thr_employees')
        .select('employee_no, full_name')
        .is('organization_id', null)
        .order('employee_no');
    
    const prefixCount = {};
    stillUnmapped?.forEach(emp => {
        const prefix = emp.employee_no.match(/^([A-Z]+)/)?.[1] || 'OTHER';
        prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
    });
    
    console.log(`Still unmapped: ${stillUnmapped?.length || 0} employees`);
    console.log('\nBy prefix:');
    Object.entries(prefixCount)
        .sort((a, b) => b[1] - a[1])
        .forEach(([prefix, count]) => {
            console.log(`  ${prefix}: ${count} employees`);
        });
    
    // Alternative mapping based on raw file analysis
    console.log('\n\n5️⃣ Alternative Mapping Strategy:\n');
    
    console.log('Based on raw data files, we can map:');
    console.log('  - ST prefix → STSB (Sarcom Technology Sdn. Bhd.) - already exists');
    console.log('  - TK prefix → TTK (Tadika Todak Kids) - already exists');
    console.log('  - TL prefix → Need to create Todak Logistics');
    console.log('  - CMP prefix → Need to create Camp Management');
    
    // Try mapping ST to STSB
    const stsOrgId = orgMap.get('STSB');
    if (stsOrgId) {
        const { data: stEmployees } = await supabase
            .from('thr_employees')
            .select('id, employee_no')
            .like('employee_no', 'ST%')
            .is('organization_id', null);
        
        if (stEmployees && stEmployees.length > 0) {
            console.log(`\n🔄 Mapping ${stEmployees.length} ST employees to Sarcom Technology...`);
            
            const { error } = await supabase
                .from('thr_employees')
                .update({ organization_id: stsOrgId })
                .in('id', stEmployees.map(e => e.id));
            
            if (!error) {
                console.log('✅ ST employees mapped successfully');
            }
        }
    }
    
    // Try mapping TK to TTK
    const ttkOrgId = orgMap.get('TTK');
    if (ttkOrgId) {
        const { data: tkEmployees } = await supabase
            .from('thr_employees')
            .select('id, employee_no')
            .like('employee_no', 'TK%')
            .is('organization_id', null);
        
        if (tkEmployees && tkEmployees.length > 0) {
            console.log(`\n🔄 Mapping ${tkEmployees.length} TK employees to Tadika Todak Kids...`);
            
            const { error } = await supabase
                .from('thr_employees')
                .update({ organization_id: ttkOrgId })
                .in('id', tkEmployees.map(e => e.id));
            
            if (!error) {
                console.log('✅ TK employees mapped successfully');
            }
        }
    }
    
    console.log('\n\n✅ Summary:');
    console.log('  - Fixed HYLN → HSB mapping');
    console.log('  - Mapped ST → STSB');
    console.log('  - Mapped TK → TTK');
    console.log('  - Still need to create organizations for TL and CMP prefixes');
    
    console.log('');
}

// Run fix
if (require.main === module) {
    fixRemainingMappings().catch(console.error);
}

module.exports = { fixRemainingMappings };