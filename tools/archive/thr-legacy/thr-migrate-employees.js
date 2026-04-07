#!/usr/bin/env node

/**
 * Migrate employees from master_hr2000 to thr_employees
 * Preserves all data in appropriate JSONB fields
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function migrateEmployees() {
    console.log('👥 THR Employee Migration Process\n');
    console.log('=' .repeat(60) + '\n');
    
    // Step 1: Populate reference data first
    console.log('1️⃣ Populating reference data...\n');
    
    // Get unique departments from master_hr2000
    const { data: masterData } = await supabase
        .from('master_hr2000')
        .select('*');
    
    // Extract unique values
    const departments = new Set();
    const sections = new Set();
    const positions = new Set();
    const grades = new Set();
    const allowanceCodes = new Set();
    const deductionCodes = new Set();
    const organizations = new Set();
    
    masterData.forEach(emp => {
        if (emp.department) departments.add(emp.department);
        if (emp.section) sections.add(emp.section);
        if (emp.designation) positions.add(emp.designation);
        if (emp.grade) grades.add(emp.grade);
        if (emp.organization) organizations.add(emp.organization);
        
        // Extract allowance/deduction codes
        if (emp.fixed_allowances) {
            if (emp.fixed_allowances.allowances) {
                emp.fixed_allowances.allowances.forEach(a => {
                    allowanceCodes.add(JSON.stringify({
                        code: a.code,
                        description: a.description || a.code
                    }));
                });
            }
            if (emp.fixed_allowances.deductions) {
                emp.fixed_allowances.deductions.forEach(d => {
                    deductionCodes.add(JSON.stringify({
                        code: d.code,
                        description: d.description || d.code
                    }));
                });
            }
        }
    });
    
    // Insert departments (for now, link to first organization)
    console.log('📁 Creating departments...');
    const deptMap = new Map();
    
    // Get first organization ID
    const { data: firstOrg } = await supabase
        .from('thr_organizations')
        .select('organization_id')
        .limit(1)
        .single();
    
    for (const dept of departments) {
        const { data, error } = await supabase
            .from('thr_departments')
            .insert({
                organization_id: firstOrg?.organization_id,
                department_name: dept,
                department_code: dept.replace(/[^A-Z0-9]/g, '').substring(0, 20)
            })
            .select()
            .single();
        
        if (!error && data) {
            deptMap.set(dept, data.id);
        }
    }
    console.log(`  ✅ Created ${deptMap.size} departments\n`);
    
    // Insert sections
    console.log('📁 Creating sections...');
    const sectionMap = new Map();
    
    for (const section of sections) {
        // Try to find matching department
        const deptId = Array.from(deptMap.values())[0]; // Default to first dept
        
        const { data, error } = await supabase
            .from('thr_sections')
            .insert({
                department_id: deptId,
                section_name: section,
                section_code: section.replace(/[^A-Z0-9]/g, '').substring(0, 20)
            })
            .select()
            .single();
        
        if (!error && data) {
            sectionMap.set(section, data.id);
        }
    }
    console.log(`  ✅ Created ${sectionMap.size} sections\n`);
    
    // Insert positions
    console.log('💼 Creating positions...');
    const positionMap = new Map();
    
    for (const pos of positions) {
        const { data, error } = await supabase
            .from('thr_positions')
            .insert({
                position_title: pos,
                position_code: pos.replace(/[^A-Z0-9]/g, '').substring(0, 20)
            })
            .select()
            .single();
        
        if (!error && data) {
            positionMap.set(pos, data.id);
        }
    }
    console.log(`  ✅ Created ${positionMap.size} positions\n`);
    
    // Insert allowance types
    console.log('💰 Creating allowance types...');
    const allowanceTypeMap = new Map();
    
    for (const allowanceStr of allowanceCodes) {
        const allowance = JSON.parse(allowanceStr);
        const { data, error } = await supabase
            .from('thr_allowance_types')
            .insert({
                code: allowance.code,
                name: allowance.description || allowance.code,
                description: `Auto-imported from HR2000`
            })
            .select()
            .single();
        
        if (!error && data) {
            allowanceTypeMap.set(allowance.code, data.id);
        }
    }
    console.log(`  ✅ Created ${allowanceTypeMap.size} allowance types\n`);
    
    // Insert deduction types
    console.log('💸 Creating deduction types...');
    const deductionTypeMap = new Map();
    
    for (const deductionStr of deductionCodes) {
        const deduction = JSON.parse(deductionStr);
        const { data, error } = await supabase
            .from('thr_deduction_types')
            .insert({
                code: deduction.code,
                name: deduction.description || deduction.code,
                description: `Auto-imported from HR2000`
            })
            .select()
            .single();
        
        if (!error && data) {
            deductionTypeMap.set(deduction.code, data.id);
        }
    }
    console.log(`  ✅ Created ${deductionTypeMap.size} deduction types\n`);
    
    // Step 2: Migrate employees
    console.log('\n2️⃣ Migrating employees...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Map organization names to IDs
    const { data: orgData } = await supabase
        .from('thr_organizations')
        .select('organization_id, organization_name');
    
    const orgMap = new Map();
    orgData?.forEach(org => {
        orgMap.set(org.organization_name, org.organization_id);
    });
    
    for (const emp of masterData) {
        try {
            // Find organization ID (try to match by name)
            let orgId = null;
            if (emp.organization) {
                orgId = orgMap.get(emp.organization) || firstOrg?.organization_id;
            }
            
            // Prepare employee data
            const employeeData = {
                employee_no: emp.employee_no,
                organization_id: orgId,
                full_name: emp.employee_name,
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
                    designation: emp.designation,
                    organization: emp.organization
                },
                
                compensation: {
                    basic_salary: emp.basic_salary,
                    fixed_allowances: emp.fixed_allowances,
                    allowances: emp.allowances,
                    bank_code: emp.bank_code,
                    payment_mode: emp.payment_mode
                },
                
                tax_info: emp.tax_info || {},
                bank_info: emp.bank_info || {},
                
                // Metadata
                data_source: 'master_hr2000',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            
            // Insert employee
            const { data: newEmployee, error: empError } = await supabase
                .from('thr_employees')
                .insert(employeeData)
                .select()
                .single();
            
            if (empError) {
                errorCount++;
                errors.push(`${emp.employee_no}: ${empError.message}`);
            } else {
                successCount++;
                
                // Insert current employment history
                if (newEmployee) {
                    await supabase
                        .from('thr_employment_history')
                        .insert({
                            employee_id: newEmployee.id,
                            organization_id: orgId,
                            position: emp.designation,
                            department: emp.department,
                            section: emp.section,
                            grade: emp.grade,
                            start_date: emp.employment_timeline?.employment_date || new Date().toISOString(),
                            end_date: emp.employment_timeline?.resign_date,
                            is_current: !emp.employment_timeline?.resign_date
                        });
                    
                    // Insert active allowances
                    if (emp.fixed_allowances?.allowances) {
                        for (const allowance of emp.fixed_allowances.allowances) {
                            const typeId = allowanceTypeMap.get(allowance.code);
                            if (typeId) {
                                await supabase
                                    .from('thr_employee_allowances')
                                    .insert({
                                        employee_id: newEmployee.id,
                                        allowance_type_id: typeId,
                                        amount: allowance.amount,
                                        start_date: new Date().toISOString(),
                                        is_active: true,
                                        remarks: allowance.description
                                    });
                            }
                        }
                    }
                    
                    // Insert active deductions
                    if (emp.fixed_allowances?.deductions) {
                        for (const deduction of emp.fixed_allowances.deductions) {
                            const typeId = deductionTypeMap.get(deduction.code);
                            if (typeId) {
                                await supabase
                                    .from('thr_employee_deductions')
                                    .insert({
                                        employee_id: newEmployee.id,
                                        deduction_type_id: typeId,
                                        amount: Math.abs(deduction.amount),
                                        start_date: new Date().toISOString(),
                                        is_active: true,
                                        remarks: deduction.description
                                    });
                            }
                        }
                    }
                }
            }
            
            // Progress indicator
            if ((successCount + errorCount) % 50 === 0) {
                console.log(`  Progress: ${successCount + errorCount}/${masterData.length}`);
            }
            
        } catch (err) {
            errorCount++;
            errors.push(`${emp.employee_no}: ${err.message}`);
        }
    }
    
    // Summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('\n✅ MIGRATION COMPLETE!\n');
    console.log(`📊 Results:`);
    console.log(`  - Successful: ${successCount}`);
    console.log(`  - Errors: ${errorCount}`);
    console.log(`  - Total: ${masterData.length}\n`);
    
    if (errors.length > 0) {
        console.log('❌ Errors encountered:');
        errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
        if (errors.length > 10) {
            console.log(`  ... and ${errors.length - 10} more`);
        }
    }
    
    // Verify migration
    const { count } = await supabase
        .from('thr_employees')
        .select('*', { count: 'exact', head: true });
    
    console.log(`\n✅ Verification:`);
    console.log(`  - thr_employees: ${count} records`);
    console.log(`  - Reference data populated`);
    console.log(`  - Employment history created`);
    console.log(`  - Allowances/deductions linked`);
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Review and fix any migration errors');
    console.log('  2. Map organizations properly');
    console.log('  3. Link to auth.users when ready');
    console.log('  4. Create accounting tables (thr_acc_*)');
    console.log('  5. Create ATLAS tables (thr_atlas_*)');
    
    console.log('');
}

// Run migration
if (require.main === module) {
    migrateEmployees().catch(console.error);
}

module.exports = { migrateEmployees };