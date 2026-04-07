#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function populateSimpleData() {
    console.log('🚀 Populating THR tables with basic data...\n');
    
    try {
        // 1. Simple Leave Types
        console.log('📋 Inserting leave types...');
        const leaveTypes = [
            { code: 'AL', name: 'Annual Leave', days_per_year: 14 },
            { code: 'ML', name: 'Medical Leave', days_per_year: 14 },
            { code: 'EL', name: 'Emergency Leave', days_per_year: 3 }
        ];
        
        for (const lt of leaveTypes) {
            const { error } = await supabase
                .from('thr_leave_types')
                .insert(lt);
            
            if (!error) {
                console.log(`  ✅ ${lt.name}`);
            }
        }
        
        // 2. Simple Claim Types
        console.log('\n💰 Inserting claim types...');
        const claimTypes = [
            { code: 'MED', name: 'Medical', monthly_limit: 500.00, yearly_limit: 6000.00 },
            { code: 'TRV', name: 'Travel', monthly_limit: 1000.00, yearly_limit: 12000.00 }
        ];
        
        for (const ct of claimTypes) {
            const { error } = await supabase
                .from('thr_claim_types')
                .insert(ct);
            
            if (!error) {
                console.log(`  ✅ ${ct.name}`);
            }
        }
        
        // 3. Get Neo's ID
        const { data: employee } = await supabase
            .from('thr_employees')
            .select('id, employee_no, full_name')
            .eq('employee_no', 'TS001')
            .single();
        
        if (!employee) {
            console.error('❌ Employee TS001 not found');
            return;
        }
        
        console.log(`\n👤 Found: ${employee.full_name}`);
        
        // 4. Create Leave Balances
        console.log('\n📅 Creating leave balances...');
        const leaveBalances = [
            {
                employee_id: employee.id,
                leave_type: 'annual',
                year: 2024,
                entitlement: 14,
                taken: 0,
                balance: 14
            },
            {
                employee_id: employee.id,
                leave_type: 'medical',
                year: 2024,
                entitlement: 14,
                taken: 7,
                balance: 7
            },
            {
                employee_id: employee.id,
                leave_type: 'emergency',
                year: 2024,
                entitlement: 3,
                taken: 1,
                balance: 2
            }
        ];
        
        for (const lb of leaveBalances) {
            const { error } = await supabase
                .from('thr_leave_balances')
                .insert(lb);
            
            if (!error) {
                console.log(`  ✅ ${lb.leave_type}: ${lb.balance} days`);
            }
        }
        
        // 5. Create Claims
        console.log('\n💳 Creating claims...');
        const claims = [
            {
                employee_id: employee.id,
                claim_type: 'medical',
                claim_no: 'CLM-2024-0001',
                claim_date: '2024-07-10',
                amount: 150.00,
                description: 'Clinic visit',
                status: 'approved',
                approved_by: employee.id,
                approved_date: '2024-07-11T10:00:00Z'
            },
            {
                employee_id: employee.id,
                claim_type: 'travel',
                claim_no: 'CLM-2024-0002',
                claim_date: '2024-07-12',
                amount: 450.00,
                description: 'Client meeting in Penang',
                status: 'pending'
            }
        ];
        
        for (const claim of claims) {
            const { error } = await supabase
                .from('thr_claims')
                .insert(claim);
            
            if (!error) {
                console.log(`  ✅ ${claim.claim_type}: RM ${claim.amount} (${claim.status})`);
            }
        }
        
        // 6. Create Assets
        console.log('\n🖥️ Creating assets...');
        
        // First create a category
        const { data: itCategory } = await supabase
            .from('thr_asset_categories')
            .select('id')
            .eq('code', 'IT')
            .single();
        
        const assets = [
            {
                asset_no: 'IT-2024-001',
                name: 'MacBook Pro 16"',
                description: 'M3 Max, 64GB RAM',
                category_id: itCategory?.id,
                brand: 'Apple',
                model: 'MacBook Pro 2024',
                purchase_date: '2024-01-15',
                purchase_price: 12000.00,
                status: 'assigned'
            },
            {
                asset_no: 'FUR-2024-055',
                name: 'Office Chair',
                description: 'Ergonomic chair',
                brand: 'Herman Miller',
                purchase_date: '2024-01-20',
                purchase_price: 1500.00,
                status: 'assigned'
            }
        ];
        
        for (const asset of assets) {
            const { data: assetData, error } = await supabase
                .from('thr_assets')
                .insert(asset)
                .select()
                .single();
            
            if (!error && assetData) {
                console.log(`  ✅ ${asset.name}`);
                
                // Create assignment
                const { error: assignError } = await supabase
                    .from('thr_asset_assignments')
                    .insert({
                        asset_id: assetData.id,
                        employee_id: employee.id,
                        assigned_date: asset.purchase_date,
                        status: 'active'
                    });
                
                if (!assignError) {
                    console.log(`     → Assigned to ${employee.full_name}`);
                }
            }
        }
        
        console.log('\n✨ Data population complete!');
        
        // 7. Verify data
        console.log('\n🔍 Verifying data...');
        
        const { count: lbCount } = await supabase
            .from('thr_leave_balances')
            .select('*', { count: 'exact', head: true });
        
        const { count: claimCount } = await supabase
            .from('thr_claims')
            .select('*', { count: 'exact', head: true });
        
        const { count: assetCount } = await supabase
            .from('thr_assets')
            .select('*', { count: 'exact', head: true });
        
        console.log(`Leave balances: ${lbCount || 0} records`);
        console.log(`Claims: ${claimCount || 0} records`);
        console.log(`Assets: ${assetCount || 0} records`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

populateSimpleData().catch(console.error);