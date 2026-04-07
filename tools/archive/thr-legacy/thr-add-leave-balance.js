#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function addLeaveBalance() {
    console.log('🏖️  Adding leave balance for Neo...\n');
    
    try {
        // Get Neo's employee ID
        const { data: neo, error: neoError } = await supabase
            .from('thr_employees')
            .select('id')
            .eq('employee_no', 'TS001')
            .single();
        
        if (neoError || !neo) {
            console.error('❌ Could not find employee TS001');
            return;
        }
        
        console.log('Found Neo:', neo.id);
        
        // Check existing balances
        const { data: existing } = await supabase
            .from('thr_leave_balances')
            .select('*')
            .eq('employee_id', neo.id)
            .eq('year', 2025);
        
        if (existing && existing.length > 0) {
            console.log('✅ Leave balances already exist:', existing.length);
            return;
        }
        
        // Add leave balances for 2025
        const balances = [
            {
                employee_id: neo.id,
                leave_type: 'Annual',
                year: 2025,
                entitlement: 14,
                taken: 0,
                balance: 14,
            },
            {
                employee_id: neo.id,
                leave_type: 'Medical',
                year: 2025,
                entitlement: 14,
                taken: 2,
                balance: 12,
            },
            {
                employee_id: neo.id,
                leave_type: 'Emergency',
                year: 2025,
                entitlement: 3,
                taken: 0,
                balance: 3,
            },
        ];
        
        const { data, error } = await supabase
            .from('thr_leave_balances')
            .insert(balances)
            .select();
        
        if (error) {
            console.error('❌ Error adding balances:', error);
        } else {
            console.log('✅ Added leave balances:', data.length);
            data.forEach(bal => {
                console.log(`  - ${bal.leave_type}: ${bal.balance}/${bal.entitlement} days`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

addLeaveBalance().catch(console.error);