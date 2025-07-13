#!/usr/bin/env node

/**
 * Show the 42 employees that had name swaps to verify their data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function showFixedEmployees() {
    console.log('📋 EMPLOYEES WITH NAME SWAPS - VERIFICATION LIST\n');
    console.log('=' .repeat(80) + '\n');
    
    // List of employee numbers that had issues
    const employeesWithIssues = [
        'MH002', 'ST0051', 'TA096', 'ST0045', 'ST0043', 'TC151', 'ST0027', 'TC152',
        'TH072', 'ST0038', 'TA036', 'ST0001', 'ST0003', 'TH069', 'ST0039', 'TA035',
        'TA048', 'TA118', 'TH058', 'ST0047', 'TH004', 'TA045', 'TA043', 'TA042',
        'ST0031', 'TA054', 'ST0012', 'ST0009', 'TA101', 'TS004', 'ST0004', 'ST0015',
        'MTSB013', 'TA111', 'TA117', 'TS025', 'TA105', 'TA041', 'TA039', 'TS001',
        'TH070', 'TH008'
    ];
    
    // Get current data for these employees
    const { data: employees } = await supabase
        .from('thr_employees')
        .select(`
            employee_no,
            full_name,
            personal_info,
            organization:thr_organizations(name),
            employment_status
        `)
        .in('employee_no', employeesWithIssues)
        .order('employee_no');
    
    if (!employees || employees.length === 0) {
        console.log('No data found');
        return;
    }
    
    console.log(`Found ${employees.length} employees:\n`);
    
    // Display in a formatted table
    employees.forEach((emp, index) => {
        console.log(`${index + 1}. ${emp.employee_no}`);
        console.log(`   Name: ${emp.full_name}`);
        console.log(`   Gender: ${emp.personal_info?.gender || 'N/A'}`);
        console.log(`   Organization: ${emp.organization?.name || 'Not assigned'}`);
        console.log(`   Status: ${emp.employment_status}`);
        
        // Show spouse name if exists
        if (emp.personal_info?.spouse_details?.name) {
            const spouseName = emp.personal_info.spouse_details.name;
            console.log(`   Spouse: ${spouseName}`);
        }
        
        // Gender-name validation
        const name = emp.full_name;
        const gender = emp.personal_info?.gender;
        let validation = '✅ Valid';
        
        if (gender === 'MALE' && (name.includes(' Binti ') || name.includes(' Bt '))) {
            validation = '❌ Male with Binti';
        } else if (gender === 'FEMALE' && name.includes(' Bin ')) {
            validation = '❌ Female with Bin';
        }
        
        console.log(`   Validation: ${validation}`);
        console.log('');
    });
    
    // Summary
    console.log('\n' + '=' .repeat(80));
    console.log('\n📊 SUMMARY:');
    console.log(`Total employees checked: ${employees.length}`);
    
    // Count by gender
    const maleCount = employees.filter(e => e.personal_info?.gender === 'MALE').length;
    const femaleCount = employees.filter(e => e.personal_info?.gender === 'FEMALE').length;
    console.log(`Males: ${maleCount}`);
    console.log(`Females: ${femaleCount}`);
    
    // Check for any remaining issues
    let issueCount = 0;
    employees.forEach(emp => {
        const name = emp.full_name;
        const gender = emp.personal_info?.gender;
        
        if ((gender === 'MALE' && (name.includes(' Binti ') || name.includes(' Bt '))) ||
            (gender === 'FEMALE' && name.includes(' Bin '))) {
            issueCount++;
        }
    });
    
    console.log(`\nRemaining gender-name mismatches: ${issueCount}`);
    
    if (issueCount === 0) {
        console.log('\n✅ All employees have valid name-gender combinations!');
    } else {
        console.log('\n⚠️  Some issues remain - please review manually');
    }
}

// Run
if (require.main === module) {
    showFixedEmployees().catch(console.error);
}

module.exports = { showFixedEmployees };