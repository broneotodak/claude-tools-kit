#!/usr/bin/env node

/**
 * Analyze organization mapping for THR employees
 * Map employee numbers to their correct organizations
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeOrganizations() {
    console.log('🏢 THR Organization Analysis\n');
    console.log('=' .repeat(60) + '\n');
    
    // Step 1: Check existing organizations
    console.log('1️⃣ Existing Organizations in thr_organizations:\n');
    
    const { data: orgs, error: orgError } = await supabase
        .from('thr_organizations')
        .select('*, brand:thr_brands(*)')
        .order('organization_name');
    
    if (orgError) {
        console.error('Error fetching organizations:', orgError);
        return;
    }
    
    console.log(`Found ${orgs?.length || 0} organizations:\n`);
    orgs?.forEach(org => {
        console.log(`  ${org.organization_code || 'N/A'} - ${org.organization_name}`);
        console.log(`    Brand: ${org.brand?.brand_name || 'Not linked'}`);
        console.log(`    ID: ${org.organization_id}\n`);
    });
    
    // Step 2: Analyze employee prefixes
    console.log('\n2️⃣ Employee Number Prefix Analysis:\n');
    
    const { data: employees } = await supabase
        .from('thr_employees')
        .select('employee_no, full_name, organization_id');
    
    // Group by prefix
    const prefixMap = new Map();
    employees?.forEach(emp => {
        // Extract prefix (usually first 2-3 characters)
        const match = emp.employee_no.match(/^([A-Z]+)/);
        if (match) {
            const prefix = match[1];
            if (!prefixMap.has(prefix)) {
                prefixMap.set(prefix, []);
            }
            prefixMap.get(prefix).push(emp);
        }
    });
    
    // Display prefix analysis
    const prefixData = Array.from(prefixMap.entries())
        .sort((a, b) => b[1].length - a[1].length);
    
    console.log('Employee prefixes and counts:');
    prefixData.forEach(([prefix, emps]) => {
        const mapped = emps.filter(e => e.organization_id).length;
        const unmapped = emps.length - mapped;
        console.log(`  ${prefix}: ${emps.length} employees (${mapped} mapped, ${unmapped} unmapped)`);
    });
    
    // Step 3: Check raw data for organization info
    console.log('\n\n3️⃣ Checking master_hr2000 for organization data:\n');
    
    const { data: masterData } = await supabase
        .from('master_hr2000')
        .select('employee_no, organization, department')
        .not('organization', 'is', null)
        .limit(10);
    
    console.log('Sample organization data from master_hr2000:');
    masterData?.forEach(emp => {
        console.log(`  ${emp.employee_no}: ${emp.organization} (${emp.department || 'No dept'})`);
    });
    
    // Step 4: Analyze raw data file patterns
    console.log('\n\n4️⃣ Organization Mapping from File Names:\n');
    
    // Based on the raw_data file names we saw
    const fileOrgMapping = {
        '10C': 'Todak 10 Corner Sdn Bhd',
        'HSB': 'Hotel Seri Malaysia Bagan Datuk',
        'LTCM': 'LAN Todak Construction & Machinery',
        'MH': 'Majestic Hotel',
        'MTSB': 'Mega Todak Sdn Bhd',
        'STSB': 'Syarikat Todak Sdn Bhd',
        'TASB': 'Todak Agro Sdn Bhd',
        'TCSB': 'Todak Construction Sdn Bhd',
        'TDSB': 'Todak Development Sdn Bhd',
        'THSB': 'Todak Holdings Sdn Bhd',
        'TPSB': 'Todak Plantation Sdn Bhd',
        'TRC': 'Todak Resources Centre',
        'TSSB': 'Todak Security Services Sdn Bhd',
        'TTK': 'Todak Trading'
    };
    
    console.log('Suggested Organization Mappings:');
    Object.entries(fileOrgMapping).forEach(([code, name]) => {
        const count = prefixMap.get(code)?.length || 0;
        console.log(`  ${code} → ${name} (${count} employees)`);
    });
    
    // Step 5: Employee prefix mapping
    console.log('\n\n5️⃣ Employee Prefix Patterns:\n');
    
    // Analyze employee number patterns
    const patterns = {
        'TC': 'Todak Construction/Core companies',
        'TS': 'Todak Services/Security',
        'TA': 'Todak Agro/Admin',
        'TH': 'Todak Holdings/Hotel',
        'TT': 'Todak Trading',
        'TM': 'Todak Machinery/Manufacturing',
        'TD': 'Todak Development',
        'TP': 'Todak Plantation'
    };
    
    console.log('Common prefixes:');
    Object.entries(patterns).forEach(([prefix, desc]) => {
        const count = prefixMap.get(prefix)?.length || 0;
        if (count > 0) {
            console.log(`  ${prefix}: ${desc} (${count} employees)`);
        }
    });
    
    // Step 6: Summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('\n📊 SUMMARY:\n');
    
    const totalEmployees = employees?.length || 0;
    const mappedEmployees = employees?.filter(e => e.organization_id).length || 0;
    const unmappedEmployees = totalEmployees - mappedEmployees;
    
    console.log(`Total Employees: ${totalEmployees}`);
    console.log(`Mapped to Organizations: ${mappedEmployees} (${Math.round(mappedEmployees/totalEmployees*100)}%)`);
    console.log(`Not Mapped: ${unmappedEmployees} (${Math.round(unmappedEmployees/totalEmployees*100)}%)`);
    
    console.log('\n⚡ Next Steps:');
    console.log('1. Create missing organizations in thr_organizations');
    console.log('2. Map employees based on their prefixes');
    console.log('3. Use file name patterns for accurate mapping');
    console.log('4. Verify mappings with sample data');
    
    console.log('');
}

// Run analysis
if (require.main === module) {
    analyzeOrganizations().catch(console.error);
}

module.exports = { analyzeOrganizations };