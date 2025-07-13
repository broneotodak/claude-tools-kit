#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_ANON_KEY // Using anon key like frontend
);

async function testRealData() {
    console.log('🧪 Testing real data queries (as frontend would)...\n');
    
    const employeeId = 'f221e445-ac90-4417-852b-ab76d792bd0c';
    
    // 1. Test leave balances query
    console.log('📅 Testing leave balances...');
    const { data: leaveData, error: leaveError } = await supabase
        .from('thr_leave_balances')
        .select('*')
        .eq('employee_id', employeeId);
    
    if (leaveError) {
        console.error('❌ Leave error:', leaveError);
    } else {
        console.log('✅ Leave balances:', leaveData);
    }
    
    // 2. Test claims query
    console.log('\n💳 Testing claims...');
    const { count: pendingClaims, error: claimError } = await supabase
        .from('thr_claims')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .eq('status', 'pending');
    
    if (claimError) {
        console.error('❌ Claims error:', claimError);
    } else {
        console.log('✅ Pending claims:', pendingClaims);
    }
    
    // 3. Test assets query
    console.log('\n🖥️ Testing assets...');
    const { count: assetsCount, error: assetError } = await supabase
        .from('thr_asset_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', employeeId)
        .eq('status', 'active');
    
    if (assetError) {
        console.error('❌ Assets error:', assetError);
    } else {
        console.log('✅ Active assets:', assetsCount);
    }
    
    // 4. Test team count
    console.log('\n👥 Testing team count...');
    const { count: teamCount, error: teamError } = await supabase
        .from('thr_employees')
        .select('*', { count: 'exact', head: true })
        .eq('reporting_to', employeeId)
        .eq('employment_status', 'active');
    
    if (teamError) {
        console.error('❌ Team error:', teamError);
    } else {
        console.log('✅ Team members:', teamCount);
    }
    
    // 5. Summary
    console.log('\n📊 Summary:');
    const leaveBalance = {
        annual: 0,
        medical: 0,
        emergency: 0,
    };
    
    if (leaveData) {
        leaveData.forEach(leave => {
            if (leave.leave_type === 'annual') leaveBalance.annual = leave.balance;
            if (leave.leave_type === 'medical') leaveBalance.medical = leave.balance;
            if (leave.leave_type === 'emergency') leaveBalance.emergency = leave.balance;
        });
    }
    
    console.log('Leave Balance:', leaveBalance);
    console.log('Pending Claims:', pendingClaims || 0);
    console.log('Assets Assigned:', assetsCount || 0);
    console.log('Team Size:', teamCount || 0);
}

testRealData().catch(console.error);