#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function initLeaveData() {
    console.log('🏖️  Initializing Leave Management Data...\n');
    
    try {
        // 1. Check/Create leave types
        console.log('📝 Checking leave types...');
        const { data: existingTypes } = await supabase
            .from('thr_leave_types')
            .select('*');
        
        if (!existingTypes || existingTypes.length === 0) {
            console.log('Creating default leave types...');
            
            const leaveTypes = [
                { code: 'AL', name: 'Annual Leave', default_days: 14, carry_forward: true, display_order: 1 },
                { code: 'ML', name: 'Medical Leave', default_days: 14, carry_forward: false, display_order: 2 },
                { code: 'EL', name: 'Emergency Leave', default_days: 3, carry_forward: false, display_order: 3 },
                { code: 'UL', name: 'Unpaid Leave', default_days: 0, carry_forward: false, display_order: 4 },
                { code: 'CL', name: 'Compassionate Leave', default_days: 3, carry_forward: false, display_order: 5 },
                { code: 'MAT', name: 'Maternity Leave', default_days: 60, carry_forward: false, display_order: 6 },
                { code: 'PAT', name: 'Paternity Leave', default_days: 7, carry_forward: false, display_order: 7 },
            ];
            
            const { error: insertError } = await supabase
                .from('thr_leave_types')
                .insert(leaveTypes);
            
            if (insertError) {
                console.error('Error creating leave types:', insertError);
            } else {
                console.log('✅ Leave types created');
            }
        } else {
            console.log(`✅ Found ${existingTypes.length} leave types`);
        }
        
        // 2. Initialize leave balances for active employees
        console.log('\n📊 Initializing leave balances for 2025...');
        
        // Get all active employees
        const { data: employees } = await supabase
            .from('thr_employees')
            .select('id')
            .eq('active_status', true);
        
        // Get leave types
        const { data: leaveTypes } = await supabase
            .from('thr_leave_types')
            .select('id, code, default_days')
            .in('code', ['AL', 'ML', 'EL']); // Only initialize main leave types
        
        if (employees && leaveTypes) {
            const currentYear = new Date().getFullYear();
            const balancesToInsert = [];
            
            for (const emp of employees) {
                for (const type of leaveTypes) {
                    // Check if balance already exists
                    const { data: existing } = await supabase
                        .from('thr_leave_balances')
                        .select('id')
                        .eq('employee_id', emp.id)
                        .eq('leave_type_id', type.id)
                        .eq('year', currentYear)
                        .single();
                    
                    if (!existing) {
                        balancesToInsert.push({
                            employee_id: emp.id,
                            leave_type_id: type.id,
                            year: currentYear,
                            balance: type.default_days,
                            used: 0,
                            earned: type.default_days,
                            adjusted: 0,
                        });
                    }
                }
            }
            
            if (balancesToInsert.length > 0) {
                const { error: balanceError } = await supabase
                    .from('thr_leave_balances')
                    .insert(balancesToInsert);
                
                if (balanceError) {
                    console.error('Error creating balances:', balanceError);
                } else {
                    console.log(`✅ Created ${balancesToInsert.length} leave balances`);
                }
            } else {
                console.log('✅ Leave balances already initialized');
            }
        }
        
        // 3. Create some sample leave applications for Neo
        console.log('\n📅 Creating sample leave applications...');
        
        const { data: neo } = await supabase
            .from('thr_employees')
            .select('id')
            .eq('employee_no', 'TS001')
            .single();
        
        if (neo) {
            const { data: annualLeaveType } = await supabase
                .from('thr_leave_types')
                .select('id')
                .eq('code', 'AL')
                .single();
            
            if (annualLeaveType) {
                // Check if sample already exists
                const { data: existingApps } = await supabase
                    .from('thr_leave_applications')
                    .select('id')
                    .eq('employee_id', neo.id);
                
                if (!existingApps || existingApps.length === 0) {
                    const sampleApplications = [
                        {
                            employee_id: neo.id,
                            leave_type_id: annualLeaveType.id,
                            start_date: '2025-01-20',
                            end_date: '2025-01-24',
                            total_days: 5,
                            reason: 'Family vacation to Langkawi',
                            status: 'approved',
                            approved_by: neo.id, // Self-approved for demo
                            approved_at: new Date().toISOString(),
                            remarks: 'Approved. Have a great vacation!',
                        },
                        {
                            employee_id: neo.id,
                            leave_type_id: annualLeaveType.id,
                            start_date: '2025-02-14',
                            end_date: '2025-02-14',
                            total_days: 1,
                            reason: 'Personal matters',
                            status: 'pending',
                        },
                    ];
                    
                    const { error: appError } = await supabase
                        .from('thr_leave_applications')
                        .insert(sampleApplications);
                    
                    if (appError) {
                        console.error('Error creating applications:', appError);
                    } else {
                        console.log('✅ Created sample leave applications');
                        
                        // Update balance for approved leave
                        const { error: updateError } = await supabase
                            .from('thr_leave_balances')
                            .update({ 
                                used: 5,
                                balance: 9, // 14 - 5
                            })
                            .eq('employee_id', neo.id)
                            .eq('leave_type_id', annualLeaveType.id)
                            .eq('year', new Date().getFullYear());
                        
                        if (!updateError) {
                            console.log('✅ Updated leave balance');
                        }
                    }
                } else {
                    console.log('✅ Sample applications already exist');
                }
            }
        }
        
        console.log('\n✨ Leave management data initialization complete!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

initLeaveData().catch(console.error);