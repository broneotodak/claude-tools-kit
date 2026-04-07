#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load THR environment
require('dotenv').config({ path: path.join(__dirname, '../../THR/.env') });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function debugViewEmail() {
    console.log('🔍 Debugging email in thr_employees_view...\n');
    
    // 1. Check what emails exist in the view
    const { data: emails, error: emailError } = await supabase
        .from('thr_employees_view')
        .select('employee_no, full_name, email')
        .limit(10);
    
    if (emailError) {
        console.error('❌ Error fetching from view:', emailError);
        return;
    }
    
    console.log('📧 Sample emails from view:');
    emails.forEach(emp => {
        console.log(`  - ${emp.employee_no}: ${emp.email || 'NULL'} (${emp.full_name})`);
    });
    
    // 2. Check the raw employee data
    console.log('\n🔍 Checking raw employee data for TS001...');
    const { data: rawEmp, error: rawError } = await supabase
        .from('thr_employees')
        .select('employee_no, full_name, contact_info')
        .eq('employee_no', 'TS001')
        .single();
    
    if (!rawError && rawEmp) {
        console.log('✅ Found employee TS001:');
        console.log(`  - Full name: ${rawEmp.full_name}`);
        console.log(`  - Contact info:`, JSON.stringify(rawEmp.contact_info, null, 2));
        
        // Check if emails is an array
        if (rawEmp.contact_info?.emails) {
            console.log(`  - First email: ${rawEmp.contact_info.emails[0]}`);
        }
    }
    
    // 3. Try to find neo@todak.com specifically
    console.log('\n🔍 Looking for neo@todak.com in view...');
    const { data: neoData, error: neoError } = await supabase
        .from('thr_employees_view')
        .select('*')
        .eq('email', 'neo@todak.com');
    
    if (neoError) {
        console.error('❌ Error:', neoError);
    } else if (neoData.length === 0) {
        console.log('❌ No records found with email neo@todak.com');
        
        // Try text search
        console.log('\n🔍 Searching for "neo" in emails...');
        const { data: searchData } = await supabase
            .from('thr_employees_view')
            .select('employee_no, full_name, email')
            .ilike('email', '%neo%');
        
        if (searchData && searchData.length > 0) {
            console.log('Found employees with "neo" in email:');
            searchData.forEach(emp => {
                console.log(`  - ${emp.employee_no}: ${emp.email} (${emp.full_name})`);
            });
        }
    } else {
        console.log('✅ Found:', neoData);
    }
}

debugViewEmail().catch(console.error);