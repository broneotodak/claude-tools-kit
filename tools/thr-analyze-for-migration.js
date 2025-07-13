#!/usr/bin/env node

/**
 * Analyze master_hr2000 data to determine additional tables needed
 * and prepare for migration to new thr_ tables
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeForMigration() {
    console.log('🔍 Analyzing master_hr2000 for Migration\n');
    console.log('=' .repeat(60) + '\n');
    
    // Get all data for analysis
    const { data: employees, error } = await supabase
        .from('master_hr2000')
        .select('*');
    
    if (error) {
        console.error('Error fetching data:', error);
        return;
    }
    
    console.log(`📊 Total Employees: ${employees.length}\n`);
    
    // 1. Analyze Organization Distribution
    console.log('1️⃣ Organization Distribution:\n');
    const orgDistribution = {};
    employees.forEach(emp => {
        const org = emp.organization || 'Unknown';
        orgDistribution[org] = (orgDistribution[org] || 0) + 1;
    });
    
    Object.entries(orgDistribution)
        .sort((a, b) => b[1] - a[1])
        .forEach(([org, count]) => {
            console.log(`  ${org}: ${count} employees`);
        });
    
    // 2. Analyze Departments/Sections
    console.log('\n\n2️⃣ Department/Section Analysis:\n');
    const deptSections = new Set();
    const departments = new Set();
    const sections = new Set();
    
    employees.forEach(emp => {
        if (emp.department) departments.add(emp.department);
        if (emp.section) sections.add(emp.section);
        if (emp.department && emp.section) {
            deptSections.add(`${emp.department} → ${emp.section}`);
        }
    });
    
    console.log(`  Unique Departments: ${departments.size}`);
    console.log(`  Unique Sections: ${sections.size}`);
    console.log(`  Department-Section Combinations: ${deptSections.size}`);
    
    // 3. Analyze Position/Grade Distribution
    console.log('\n\n3️⃣ Position & Grade Analysis:\n');
    const positions = new Set();
    const grades = new Set();
    const staffCategories = new Set();
    
    employees.forEach(emp => {
        if (emp.position) positions.add(emp.position);
        if (emp.grade) grades.add(emp.grade);
        if (emp.staff_category) staffCategories.add(emp.staff_category);
    });
    
    console.log(`  Unique Positions: ${positions.size}`);
    console.log(`  Unique Grades: ${grades.size}`);
    console.log(`  Staff Categories: ${staffCategories.size}`);
    
    // 4. Analyze Allowances/Deductions Patterns
    console.log('\n\n4️⃣ Compensation Patterns:\n');
    const allowanceTypes = new Set();
    const deductionTypes = new Set();
    
    employees.forEach(emp => {
        if (emp.fixed_allowances) {
            const fixed = emp.fixed_allowances;
            if (fixed.allowances) {
                fixed.allowances.forEach(a => allowanceTypes.add(a.code));
            }
            if (fixed.deductions) {
                fixed.deductions.forEach(d => deductionTypes.add(d.code));
            }
        }
        if (emp.allowances) {
            emp.allowances.forEach(a => allowanceTypes.add(a.code));
        }
    });
    
    console.log(`  Unique Allowance Types: ${allowanceTypes.size}`);
    console.log(`  Allowances: ${Array.from(allowanceTypes).join(', ')}`);
    console.log(`\n  Unique Deduction Types: ${deductionTypes.size}`);
    console.log(`  Deductions: ${Array.from(deductionTypes).join(', ')}`);
    
    // 5. Employment Status Analysis
    console.log('\n\n5️⃣ Employment Status:\n');
    const activeCount = employees.filter(emp => emp.active_status === true).length;
    const resignedCount = employees.filter(emp => emp.employment_timeline?.resign_date).length;
    
    console.log(`  Active Employees: ${activeCount}`);
    console.log(`  Resigned/Inactive: ${employees.length - activeCount}`);
    console.log(`  With Resign Date: ${resignedCount}`);
    
    // 6. Data Quality Check
    console.log('\n\n6️⃣ Data Quality Check:\n');
    const missingIC = employees.filter(emp => !emp.ic_no).length;
    const missingEmail = employees.filter(emp => !emp.contact_info?.company_email).length;
    const missingDept = employees.filter(emp => !emp.department).length;
    const missingOrg = employees.filter(emp => !emp.organization).length;
    
    console.log(`  Missing IC Number: ${missingIC}`);
    console.log(`  Missing Company Email: ${missingEmail}`);
    console.log(`  Missing Department: ${missingDept}`);
    console.log(`  Missing Organization: ${missingOrg}`);
    
    // 7. Proposed Additional Tables
    console.log('\n\n' + '=' .repeat(60));
    console.log('\n🏗️ PROPOSED ADDITIONAL TABLES:\n');
    
    console.log('1. thr_departments');
    console.log('   - Links to thr_organizations');
    console.log('   - Manages department hierarchy\n');
    
    console.log('2. thr_positions');
    console.log('   - Master list of positions');
    console.log('   - Links to grades and categories\n');
    
    console.log('3. thr_allowance_types');
    console.log('   - Define allowance codes & descriptions');
    console.log('   - Set calculation rules\n');
    
    console.log('4. thr_deduction_types');
    console.log('   - Define deduction codes & descriptions');
    console.log('   - Set calculation rules\n');
    
    console.log('5. thr_employee_allowances');
    console.log('   - Active allowances per employee');
    console.log('   - Start/end dates, amounts\n');
    
    console.log('6. thr_employee_deductions');
    console.log('   - Active deductions per employee');
    console.log('   - Start/end dates, amounts\n');
    
    // 8. Migration Strategy
    console.log('\n📋 MIGRATION STRATEGY:\n');
    console.log('Phase 1: Reference Data');
    console.log('  - Create & populate thr_departments');
    console.log('  - Create & populate thr_positions');
    console.log('  - Create & populate allowance/deduction types\n');
    
    console.log('Phase 2: Employee Data');
    console.log('  - Migrate to thr_employees with auth_user_id NULL');
    console.log('  - Map organizations properly');
    console.log('  - Preserve all JSONB data\n');
    
    console.log('Phase 3: Transactional Data');
    console.log('  - Extract current employment to thr_employment_history');
    console.log('  - Extract allowances to thr_employee_allowances');
    console.log('  - Extract deductions to thr_employee_deductions\n');
    
    console.log('Phase 4: Authentication');
    console.log('  - Add auth_user_id column to thr_employees');
    console.log('  - Link via company_email matching');
    console.log('  - Enable RLS policies');
    
    console.log('\n');
}

// Run analysis
if (require.main === module) {
    analyzeForMigration().catch(console.error);
}

module.exports = { analyzeForMigration };