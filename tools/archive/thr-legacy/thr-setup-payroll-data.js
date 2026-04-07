#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function setupPayrollData() {
    console.log('💰 Setting up sample payroll data...\n');
    
    try {
        // Get organization
        const { data: org } = await supabase
            .from('thr_organizations')
            .select('id')
            .eq('organization_code', 'TS')
            .single();
        
        if (!org) {
            console.error('Organization not found');
            return;
        }
        
        // Get employees
        const { data: employees } = await supabase
            .from('thr_employees')
            .select('id, employee_no, current_basic_salary')
            .eq('organization_id', org.id)
            .limit(5);
        
        console.log(`Found ${employees?.length || 0} employees`);
        
        // Setup salary components for each employee
        const salaryComponents = [];
        
        for (const emp of employees || []) {
            const basicSalary = parseFloat(emp.current_basic_salary || 5000);
            
            // Basic salary
            salaryComponents.push({
                employee_id: emp.id,
                component_id: '1', // Would be actual UUID
                amount: basicSalary,
                effective_from: '2024-01-01',
                is_active: true,
            });
            
            // Allowances (percentage of basic)
            salaryComponents.push({
                employee_id: emp.id,
                component_id: '2', // HRA
                amount: basicSalary * 0.20,
                effective_from: '2024-01-01',
                is_active: true,
            });
            
            salaryComponents.push({
                employee_id: emp.id,
                component_id: '3', // Transport
                amount: 500,
                effective_from: '2024-01-01',
                is_active: true,
            });
        }
        
        console.log(`\nCreating ${salaryComponents.length} salary component entries...`);
        
        // Note: In production, would insert actual salary components
        console.log('✅ Salary components setup complete (simulated)');
        
        // Create a sample payroll run
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        
        console.log(`\nCreating payroll run for ${currentMonth}/${currentYear}...`);
        
        const { data: payrollRun, error: runError } = await supabase
            .from('thr_payroll_runs')
            .insert({
                organization_id: org.id,
                month: currentMonth,
                year: currentYear,
                status: 'draft',
                run_date: new Date().toISOString(),
                total_gross: 50000, // Sample total
                total_deductions: 5000,
                total_net: 45000,
            })
            .select()
            .single();
        
        if (runError) {
            console.error('Error creating payroll run:', runError);
        } else {
            console.log('✅ Payroll run created');
        }
        
        // Create sample attendance records
        console.log('\nCreating sample attendance records...');
        
        const today = new Date();
        const attendanceRecords = [];
        
        for (const emp of employees || []) {
            // Create records for last 7 days
            for (let i = 0; i < 7; i++) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                const dayOfWeek = date.getDay();
                
                // Skip weekends
                if (dayOfWeek === 0 || dayOfWeek === 6) continue;
                
                const checkIn = new Date(date);
                checkIn.setHours(8 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
                
                const checkOut = new Date(date);
                checkOut.setHours(17 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
                
                const workHours = (checkOut - checkIn) / (1000 * 60 * 60);
                
                attendanceRecords.push({
                    employee_id: emp.id,
                    date: dateStr,
                    check_in_time: checkIn.toISOString(),
                    check_out_time: i === 0 ? null : checkOut.toISOString(), // Today might not have checkout
                    status: checkIn.getHours() > 9 ? 'late' : 'present',
                    work_hours: i === 0 ? null : workHours.toFixed(2),
                });
            }
        }
        
        const { error: attError } = await supabase
            .from('thr_attendance')
            .insert(attendanceRecords);
        
        if (attError) {
            console.error('Error creating attendance:', attError);
        } else {
            console.log(`✅ Created ${attendanceRecords.length} attendance records`);
        }
        
        console.log('\n✅ Payroll and attendance setup complete!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

setupPayrollData().catch(console.error);