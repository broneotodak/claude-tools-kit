#!/usr/bin/env node

/**
 * Generate detailed report of 42 employees with name swaps
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function generate42EmployeesReport() {
    console.log('📋 DETAILED REPORT: 42 EMPLOYEES WITH NAME SWAPS\n');
    console.log('Generated:', new Date().toISOString());
    console.log('=' .repeat(80) + '\n');
    
    // List of 42 employees
    const employeeNumbers = [
        'MH002', 'ST0051', 'TA096', 'ST0045', 'ST0043', 'TC151', 'ST0027', 'TC152',
        'TH072', 'ST0038', 'TA036', 'ST0001', 'ST0003', 'TH069', 'ST0039', 'TA035',
        'TA048', 'TA118', 'TH058', 'ST0047', 'TH004', 'TA045', 'TA043', 'TA042',
        'ST0031', 'TA054', 'ST0012', 'ST0009', 'TA101', 'TS004', 'ST0004', 'ST0015',
        'MTSB013', 'TA111', 'TA117', 'TS025', 'TA105', 'TA041', 'TA039', 'TS001',
        'TH070', 'TH008'
    ];
    
    // Get all data
    const { data: employees } = await supabase
        .from('thr_employees')
        .select(`
            *,
            organization:thr_organizations(name, organization_code),
            position:thr_positions(name),
            department:thr_departments(name)
        `)
        .in('employee_no', employeeNumbers)
        .order('employee_no');
    
    // Create CSV data
    const csvLines = ['Employee_No,Full_Name,Gender,Email,Phone,Organization,Department,Position,Employment_Status,Join_Date,Spouse_Name'];
    
    // Create detailed report
    const report = [];
    
    employees?.forEach((emp, index) => {
        const email = emp.contact_info?.emails?.personal || emp.contact_info?.emails?.company || 'No email';
        const phone = emp.contact_info?.phone?.mobile || 'No phone';
        const spouseName = emp.personal_info?.spouse_details?.name || 'No spouse data';
        const joinDate = emp.employment_info?.join_date || 'Unknown';
        
        // Console output
        console.log(`${index + 1}. ${emp.employee_no} - ${emp.full_name}`);
        console.log(`   Gender: ${emp.personal_info?.gender}`);
        console.log(`   Email: ${email}`);
        console.log(`   Phone: ${phone}`);
        console.log(`   Organization: ${emp.organization?.name || 'Not assigned'}`);
        console.log(`   Department: ${emp.department?.name || emp.employment_info?.department || 'Not assigned'}`);
        console.log(`   Position: ${emp.position?.name || emp.employment_info?.position || emp.employment_info?.designation || 'Not assigned'}`);
        console.log(`   Status: ${emp.employment_status}`);
        console.log(`   Join Date: ${joinDate}`);
        console.log(`   Spouse: ${spouseName}`);
        
        // Gender-name validation
        const name = emp.full_name;
        const gender = emp.personal_info?.gender;
        let issue = '';
        
        if (gender === 'MALE' && (name.includes(' Binti ') || name.includes(' Bt '))) {
            issue = 'Male with Binti';
        } else if (gender === 'FEMALE' && name.includes(' Bin ')) {
            issue = 'Female with Bin';
        } else if (name === spouseName) {
            issue = 'Name matches spouse name';
        }
        
        if (issue) {
            console.log(`   ⚠️  ISSUE: ${issue}`);
        }
        console.log('');
        
        // Add to CSV
        csvLines.push([
            emp.employee_no,
            emp.full_name,
            emp.personal_info?.gender || '',
            email,
            phone,
            emp.organization?.name || '',
            emp.department?.name || emp.employment_info?.department || '',
            emp.position?.name || emp.employment_info?.position || emp.employment_info?.designation || '',
            emp.employment_status,
            joinDate,
            spouseName
        ].map(field => `"${field}"`).join(','));
        
        // Add to report
        report.push({
            employee_no: emp.employee_no,
            full_name: emp.full_name,
            gender: emp.personal_info?.gender,
            email,
            phone,
            organization: emp.organization?.name,
            status: emp.employment_status,
            spouse_name: spouseName,
            issue
        });
    });
    
    // Save CSV file
    const csvContent = csvLines.join('\n');
    fs.writeFileSync('./42-employees-name-swaps.csv', csvContent);
    console.log('\n📄 CSV file saved: 42-employees-name-swaps.csv');
    
    // Save JSON report
    fs.writeFileSync('./42-employees-name-swaps.json', JSON.stringify(report, null, 2));
    console.log('📄 JSON file saved: 42-employees-name-swaps.json');
    
    // Summary
    console.log('\n' + '=' .repeat(80));
    console.log('\n📊 SUMMARY:');
    console.log(`Total employees: ${employees?.length || 0}`);
    
    const activeCount = employees?.filter(e => e.employment_status === 'active').length || 0;
    const resignedCount = employees?.filter(e => e.employment_status === 'resigned').length || 0;
    console.log(`Active: ${activeCount}`);
    console.log(`Resigned: ${resignedCount}`);
    
    // Count by organization
    console.log('\n🏢 BY ORGANIZATION:');
    const orgCounts = {};
    employees?.forEach(emp => {
        const org = emp.organization?.name || 'Not assigned';
        orgCounts[org] = (orgCounts[org] || 0) + 1;
    });
    
    Object.entries(orgCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([org, count]) => {
            console.log(`  ${org}: ${count} employees`);
        });
    
    console.log('\n✅ Report generated successfully!');
    console.log('Check the CSV and JSON files for detailed data.');
}

// Run
if (require.main === module) {
    generate42EmployeesReport().catch(console.error);
}

module.exports = { generate42EmployeesReport };