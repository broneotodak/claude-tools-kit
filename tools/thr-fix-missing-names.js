#!/usr/bin/env node

/**
 * Fix missing employee names and re-migrate
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixMissingNames() {
    console.log('🔧 Fixing missing employee names\n');
    
    // Get employees with missing names
    const { data: employees } = await supabase
        .from('master_hr2000')
        .select('*')
        .or('employee_name.is.null,employee_name.eq.');
    
    console.log(`Found ${employees?.length || 0} employees with missing names\n`);
    
    // Get organization ID
    const { data: firstOrg } = await supabase
        .from('thr_organizations')
        .select('organization_id')
        .limit(1)
        .single();
    
    // Get reference data maps
    const { data: depts } = await supabase.from('thr_departments').select('*');
    const { data: sections } = await supabase.from('thr_sections').select('*');
    const { data: positions } = await supabase.from('thr_positions').select('*');
    const { data: allowTypes } = await supabase.from('thr_allowance_types').select('*');
    const { data: deductTypes } = await supabase.from('thr_deduction_types').select('*');
    
    const deptMap = new Map(depts?.map(d => [d.department_name, d.id]));
    const sectionMap = new Map(sections?.map(s => [s.section_name, s.id]));
    const positionMap = new Map(positions?.map(p => [p.position_title, p.id]));
    const allowanceTypeMap = new Map(allowTypes?.map(a => [a.code, a.id]));
    const deductionTypeMap = new Map(deductTypes?.map(d => [d.code, d.id]));
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const emp of employees || []) {
        try {
            // Use employee number as name if name is missing
            const fullName = emp.employee_name || `Employee ${emp.employee_no}`;
            
            const employeeData = {
                employee_no: emp.employee_no,
                organization_id: firstOrg?.organization_id,
                full_name: fullName,
                ic_no: emp.ic_no,
                active_status: emp.active_status || false,
                employment_status: emp.employment_timeline?.resign_date ? 'resigned' : 'active',
                
                // Reference IDs
                position_id: emp.designation ? positionMap.get(emp.designation) : null,
                department_id: emp.department ? deptMap.get(emp.department) : null,
                section_id: emp.section ? sectionMap.get(emp.section) : null,
                
                // JSONB fields
                personal_info: {
                    gender: emp.gender,
                    dob: emp.dob,
                    marital_status: emp.marital_status,
                    race: emp.race,
                    religion: emp.religion,
                    citizenship: emp.citizenship,
                    spouse_details: emp.spouse_details
                },
                
                contact_info: emp.contact_info || {},
                employment_info: {
                    ...(emp.employment_timeline || {}),
                    grade: emp.grade,
                    staff_category: emp.staff_category,
                    department: emp.department,
                    section: emp.section,
                    designation: emp.designation
                },
                compensation: {
                    basic_salary: emp.basic_salary,
                    fixed_allowances: emp.fixed_allowances,
                    allowances: emp.allowances
                },
                tax_info: emp.tax_info || {},
                bank_info: emp.bank_info || {},
                data_source: 'master_hr2000'
            };
            
            const { data: newEmployee, error } = await supabase
                .from('thr_employees')
                .insert(employeeData)
                .select()
                .single();
            
            if (error) {
                console.log(`❌ Failed: ${emp.employee_no} - ${error.message}`);
                errorCount++;
            } else {
                console.log(`✅ Migrated: ${emp.employee_no} as "${fullName}"`);
                successCount++;
                
                // Add employment history
                if (newEmployee) {
                    await supabase
                        .from('thr_employment_history')
                        .insert({
                            employee_id: newEmployee.id,
                            organization_id: firstOrg?.organization_id,
                            position: emp.designation,
                            department: emp.department,
                            section: emp.section,
                            grade: emp.grade,
                            start_date: emp.employment_timeline?.employment_date || new Date().toISOString(),
                            end_date: emp.employment_timeline?.resign_date,
                            is_current: !emp.employment_timeline?.resign_date
                        });
                }
            }
        } catch (err) {
            console.log(`❌ Error: ${emp.employee_no} - ${err.message}`);
            errorCount++;
        }
    }
    
    const { count } = await supabase
        .from('thr_employees')
        .select('*', { count: 'exact', head: true });
    
    console.log('\n' + '=' .repeat(60));
    console.log('\n✅ Fix Complete!');
    console.log(`  - Fixed and migrated: ${successCount}`);
    console.log(`  - Failed: ${errorCount}`);
    console.log(`  - Total thr_employees: ${count}\n`);
}

if (require.main === module) {
    fixMissingNames().catch(console.error);
}

module.exports = { fixMissingNames };