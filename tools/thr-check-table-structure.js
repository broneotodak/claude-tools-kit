#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.ATLAS_SUPABASE_ANON_KEY
);

async function checkTableStructure() {
    console.log('🔍 Checking table structures...\n');
    
    // Check organizations table
    const { data: orgData, error: orgError } = await supabase
        .from('thr_organizations')
        .select('*')
        .limit(1);
    
    if (orgError) {
        console.log('❌ Error with thr_organizations:', orgError.message);
    } else if (orgData && orgData.length > 0) {
        console.log('✅ thr_organizations columns:');
        console.log(Object.keys(orgData[0]).join(', '));
    }
    
    // Check departments table
    const { data: deptData, error: deptError } = await supabase
        .from('thr_departments')
        .select('*')
        .limit(1);
    
    if (deptError) {
        console.log('\n❌ Error with thr_departments:', deptError.message);
    } else if (deptData && deptData.length > 0) {
        console.log('\n✅ thr_departments columns:');
        console.log(Object.keys(deptData[0]).join(', '));
    }
    
    // Check positions table
    const { data: posData, error: posError } = await supabase
        .from('thr_positions')
        .select('*')
        .limit(1);
    
    if (posError) {
        console.log('\n❌ Error with thr_positions:', posError.message);
    } else if (posData && posData.length > 0) {
        console.log('\n✅ thr_positions columns:');
        console.log(Object.keys(posData[0]).join(', '));
    }
    
    // Check an employee to see what IDs they have
    const { data: empData, error: empError } = await supabase
        .from('thr_employees')
        .select('id, employee_no, organization_id, department_id, position_id')
        .eq('employee_no', 'TS001')
        .single();
    
    if (!empError && empData) {
        console.log('\n📋 Sample employee (TS001):');
        console.log(`  - organization_id: ${empData.organization_id}`);
        console.log(`  - department_id: ${empData.department_id}`);
        console.log(`  - position_id: ${empData.position_id}`);
    }
}

checkTableStructure().catch(console.error);