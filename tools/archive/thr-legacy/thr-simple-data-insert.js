#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function insertSimpleData() {
    console.log('🎯 Inserting test data for Neo Todak...\n');
    
    const employeeId = 'f221e445-ac90-4417-852b-ab76d792bd0c';
    
    // 1. Insert leave balances
    console.log('📋 Inserting leave balances...');
    const leaveBalances = [
        {
            employee_id: employeeId,
            leave_type: 'annual',
            year: 2024,
            entitlement: 14,
            taken: 0,
            balance: 14
        },
        {
            employee_id: employeeId,
            leave_type: 'medical', 
            year: 2024,
            entitlement: 14,
            taken: 7,
            balance: 7
        },
        {
            employee_id: employeeId,
            leave_type: 'emergency',
            year: 2024,
            entitlement: 3,
            taken: 1,
            balance: 2
        }
    ];
    
    const { data: leaveData, error: leaveError } = await supabase
        .from('thr_leave_balances')
        .insert(leaveBalances)
        .select();
    
    if (leaveError) {
        console.error('❌ Leave balance error:', leaveError);
    } else {
        console.log('✅ Leave balances inserted:', leaveData.length);
    }
    
    // 2. Insert claims
    console.log('\n💰 Inserting claims...');
    const claims = [
        {
            employee_id: employeeId,
            claim_type: 'medical',
            amount: 150.00,
            status: 'approved',
            claim_date: '2024-07-10',
            description: 'Clinic visit - Dr. Ahmad'
        },
        {
            employee_id: employeeId,
            claim_type: 'travel',
            amount: 450.00,
            status: 'pending',
            claim_date: '2024-07-12',
            description: 'Client meeting in Penang'
        }
    ];
    
    const { data: claimData, error: claimError } = await supabase
        .from('thr_claims')
        .insert(claims)
        .select();
    
    if (claimError) {
        console.error('❌ Claims error:', claimError);
    } else {
        console.log('✅ Claims inserted:', claimData.length);
    }
    
    // 3. Check if we need atlas tables
    console.log('\n🔍 Checking for atlas tables...');
    
    // Try thr_atlas_assets
    const testAsset = {
        asset_no: 'IT-2024-001',
        name: 'MacBook Pro 16"',
        status: 'in_use',
        purchase_date: '2024-01-15',
        purchase_price: 12000.00
    };
    
    const { data: assetData, error: assetError } = await supabase
        .from('thr_atlas_assets')
        .insert(testAsset)
        .select()
        .single();
    
    if (assetError) {
        // Try without prefix
        const { data: altAssetData, error: altAssetError } = await supabase
            .from('assets')
            .insert(testAsset)
            .select()
            .single();
        
        if (!altAssetError && altAssetData) {
            console.log('✅ Asset created in assets table');
            
            // Assign to employee
            await supabase
                .from('employee_assets')
                .insert({
                    employee_id: employeeId,
                    asset_id: altAssetData.id,
                    assigned_date: '2024-01-15',
                    status: 'assigned'
                });
            console.log('✅ Asset assigned to employee');
        }
    } else if (assetData) {
        console.log('✅ Asset created in thr_atlas_assets');
        
        // Assign to employee
        await supabase
            .from('thr_atlas_employee_assets')
            .insert({
                employee_id: employeeId,
                asset_id: assetData.id,
                assigned_date: '2024-01-15',
                status: 'assigned'
            });
        console.log('✅ Asset assigned to employee');
    }
    
    console.log('\n✨ Done!');
}

insertSimpleData().catch(console.error);