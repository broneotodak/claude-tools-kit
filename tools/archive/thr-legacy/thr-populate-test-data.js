#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function populateTestData() {
    console.log('🎯 Populating test data for THR system...\n');
    
    // Get Neo Todak's employee ID
    const { data: employee } = await supabase
        .from('thr_employees')
        .select('id, employee_no, full_name')
        .eq('employee_no', 'TS001')
        .single();
    
    if (!employee) {
        console.error('❌ Employee TS001 not found');
        return;
    }
    
    console.log(`✅ Found employee: ${employee.full_name} (${employee.id})\n`);
    
    // 1. Create leave types if they don't exist
    console.log('📋 Creating leave types...');
    const leaveTypes = [
        { code: 'AL', name: 'Annual Leave', days_per_year: 14 },
        { code: 'ML', name: 'Medical Leave', days_per_year: 14 },
        { code: 'EL', name: 'Emergency Leave', days_per_year: 3 }
    ];
    
    for (const type of leaveTypes) {
        const { error } = await supabase
            .from('thr_leave_types')
            .upsert(type, { onConflict: 'code' });
        
        if (!error) {
            console.log(`  ✅ ${type.name}`);
        }
    }
    
    // 2. Create leave balances for 2024
    console.log('\n💼 Creating leave balances...');
    const year = new Date().getFullYear();
    
    const balances = [
        { 
            employee_id: employee.id, 
            leave_type: 'annual',
            year: year,
            entitlement: 14,
            taken: 0,
            balance: 14
        },
        { 
            employee_id: employee.id, 
            leave_type: 'medical',
            year: year,
            entitlement: 14,
            taken: 7,
            balance: 7
        },
        { 
            employee_id: employee.id, 
            leave_type: 'emergency',
            year: year,
            entitlement: 3,
            taken: 1,
            balance: 2
        }
    ];
    
    for (const balance of balances) {
        const { error } = await supabase
            .from('thr_leave_balances')
            .upsert(balance, { 
                onConflict: 'employee_id,leave_type,year' 
            });
        
        if (!error) {
            console.log(`  ✅ ${balance.leave_type}: ${balance.balance} days`);
        }
    }
    
    // 3. Create some sample claims
    console.log('\n💰 Creating sample claims...');
    
    const claims = [
        {
            employee_id: employee.id,
            claim_type: 'medical',
            amount: 150.00,
            status: 'approved',
            claim_date: '2024-07-10',
            description: 'Clinic visit - Dr. Ahmad',
            approved_date: '2024-07-11',
            approved_by: employee.id
        },
        {
            employee_id: employee.id,
            claim_type: 'travel',
            amount: 450.00,
            status: 'pending',
            claim_date: '2024-07-12',
            description: 'Client meeting in Penang - flight and accommodation'
        }
    ];
    
    for (const claim of claims) {
        const { data, error } = await supabase
            .from('thr_claims')
            .insert(claim)
            .select();
        
        if (!error && data) {
            console.log(`  ✅ ${claim.claim_type} claim: RM ${claim.amount} (${claim.status})`);
        }
    }
    
    // 4. Create some assets
    console.log('\n🖥️ Creating sample assets...');
    
    // First ensure asset types exist
    const assetTypes = [
        { code: 'IT', name: 'IT Equipment' },
        { code: 'FUR', name: 'Furniture' }
    ];
    
    for (const type of assetTypes) {
        await supabase
            .from('thr_atlas_asset_types')
            .upsert(type, { onConflict: 'code' });
    }
    
    // Create assets
    const assets = [
        {
            asset_no: 'IT-2024-001',
            name: 'MacBook Pro 16"',
            asset_type_id: 'IT',
            status: 'in_use',
            purchase_date: '2024-01-15',
            purchase_price: 12000.00
        },
        {
            asset_no: 'FUR-2024-055',
            name: 'Ergonomic Office Chair',
            asset_type_id: 'FUR',
            status: 'in_use',
            purchase_date: '2024-01-20',
            purchase_price: 1500.00
        }
    ];
    
    for (const asset of assets) {
        // Insert asset
        const { data: assetData } = await supabase
            .from('thr_atlas_assets')
            .upsert(asset, { onConflict: 'asset_no' })
            .select()
            .single();
        
        if (assetData) {
            // Assign to employee
            await supabase
                .from('thr_atlas_employee_assets')
                .upsert({
                    employee_id: employee.id,
                    asset_id: assetData.id,
                    assigned_date: asset.purchase_date,
                    status: 'assigned'
                }, { 
                    onConflict: 'employee_id,asset_id' 
                });
            
            console.log(`  ✅ ${asset.name} assigned`);
        }
    }
    
    console.log('\n✨ Test data population complete!');
}

populateTestData().catch(console.error);