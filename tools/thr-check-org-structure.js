#!/usr/bin/env node

/**
 * Check actual structure of organization tables
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrgStructure() {
    console.log('🔍 Checking Organization Table Structure\n');
    
    // Check thr_brands
    console.log('1️⃣ thr_brands structure:');
    const { data: brands } = await supabase
        .from('thr_brands')
        .select('*')
        .limit(1);
    
    if (brands && brands.length > 0) {
        console.log('Columns:', Object.keys(brands[0]));
        console.log('\nSample data:');
        console.log(brands[0]);
    }
    
    // Check thr_organizations
    console.log('\n\n2️⃣ thr_organizations structure:');
    const { data: orgs } = await supabase
        .from('thr_organizations')
        .select('*')
        .limit(1);
    
    if (orgs && orgs.length > 0) {
        console.log('Columns:', Object.keys(orgs[0]));
        console.log('\nSample data:');
        console.log(orgs[0]);
    }
    
    // List all organizations
    console.log('\n\n3️⃣ All Organizations:');
    const { data: allOrgs } = await supabase
        .from('thr_organizations')
        .select('*');
    
    allOrgs?.forEach(org => {
        console.log(`\nOrganization ID: ${org.organization_id}`);
        Object.entries(org).forEach(([key, value]) => {
            if (value !== null && key !== 'organization_id') {
                console.log(`  ${key}: ${value}`);
            }
        });
    });
    
    // Count employees by organization
    console.log('\n\n4️⃣ Employee Distribution:');
    const { data: employees } = await supabase
        .from('thr_employees')
        .select('organization_id');
    
    const orgCounts = {};
    employees?.forEach(emp => {
        const orgId = emp.organization_id || 'unmapped';
        orgCounts[orgId] = (orgCounts[orgId] || 0) + 1;
    });
    
    console.log('Organization ID → Employee Count:');
    Object.entries(orgCounts).forEach(([orgId, count]) => {
        console.log(`  ${orgId}: ${count} employees`);
    });
}

checkOrgStructure().catch(console.error);