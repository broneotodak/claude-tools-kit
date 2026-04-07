#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function populateAllTables() {
    console.log('🚀 Populating THR tables with reference and test data...\n');
    
    try {
        // 1. Populate Leave Types
        console.log('📋 Populating leave types...');
        const leaveTypes = [
            { code: 'AL', name: 'Annual Leave', days_per_year: 14, is_carry_forward: true, max_carry_forward: 7 },
            { code: 'ML', name: 'Medical Leave', days_per_year: 14, is_carry_forward: false, max_carry_forward: 0 },
            { code: 'EL', name: 'Emergency Leave', days_per_year: 3, is_carry_forward: false, max_carry_forward: 0 },
            { code: 'UPL', name: 'Unpaid Leave', days_per_year: 0, is_carry_forward: false, max_carry_forward: 0 },
            { code: 'MAT', name: 'Maternity Leave', days_per_year: 60, is_carry_forward: false, max_carry_forward: 0 },
            { code: 'PAT', name: 'Paternity Leave', days_per_year: 7, is_carry_forward: false, max_carry_forward: 0 }
        ];
        
        const { error: ltError } = await supabase
            .from('thr_leave_types')
            .upsert(leaveTypes, { onConflict: 'code' });
        
        if (ltError) {
            console.error('❌ Leave types error:', ltError);
        } else {
            console.log('✅ Leave types populated');
        }
        
        // 2. Populate Claim Types
        console.log('\n💰 Populating claim types...');
        const claimTypes = [
            { code: 'MED', name: 'Medical', monthly_limit: 500.00, yearly_limit: 6000.00, requires_receipt: true },
            { code: 'TRV', name: 'Travel', monthly_limit: 1000.00, yearly_limit: 12000.00, requires_receipt: true },
            { code: 'MOB', name: 'Mobile Phone', monthly_limit: 150.00, yearly_limit: 1800.00, requires_receipt: true },
            { code: 'ENT', name: 'Entertainment', monthly_limit: 500.00, yearly_limit: 6000.00, requires_receipt: true },
            { code: 'TRN', name: 'Training', monthly_limit: null, yearly_limit: 5000.00, requires_receipt: true },
            { code: 'MISC', name: 'Miscellaneous', monthly_limit: 200.00, yearly_limit: 2400.00, requires_receipt: true }
        ];
        
        const { error: ctError } = await supabase
            .from('thr_claim_types')
            .upsert(claimTypes, { onConflict: 'code' });
        
        if (ctError) {
            console.error('❌ Claim types error:', ctError);
        } else {
            console.log('✅ Claim types populated');
        }
        
        // 3. Populate Asset Categories
        console.log('\n🖥️ Populating asset categories...');
        const assetCategories = [
            { code: 'IT', name: 'IT Equipment', depreciation_rate: 33.33 },
            { code: 'MOB', name: 'Mobile Devices', depreciation_rate: 50.00 },
            { code: 'FUR', name: 'Furniture', depreciation_rate: 10.00 },
            { code: 'VEH', name: 'Vehicles', depreciation_rate: 20.00 },
            { code: 'OFF', name: 'Office Equipment', depreciation_rate: 20.00 }
        ];
        
        const { error: acError } = await supabase
            .from('thr_asset_categories')
            .upsert(assetCategories, { onConflict: 'code' });
        
        if (acError) {
            console.error('❌ Asset categories error:', acError);
        } else {
            console.log('✅ Asset categories populated');
        }
        
        // 4. Create test data for Neo Todak
        console.log('\n👤 Creating test data for Neo Todak...');
        
        // Get Neo's employee ID
        const { data: employee } = await supabase
            .from('thr_employees')
            .select('id, employee_no, full_name')
            .eq('employee_no', 'TS001')
            .single();
        
        if (!employee) {
            console.error('❌ Employee TS001 not found');
            return;
        }
        
        console.log(`Found: ${employee.full_name} (${employee.id})`);
        
        // 5. Create leave balances for 2024
        console.log('\n📅 Creating leave balances...');
        const currentYear = new Date().getFullYear();
        
        // Get leave type IDs
        const { data: leaveTypesData } = await supabase
            .from('thr_leave_types')
            .select('id, code, days_per_year');
        
        if (leaveTypesData) {
            const leaveBalances = leaveTypesData
                .filter(lt => ['AL', 'ML', 'EL'].includes(lt.code))
                .map(lt => ({
                    employee_id: employee.id,
                    leave_type_id: lt.id,
                    leave_type: lt.code.toLowerCase(),
                    year: currentYear,
                    entitlement: lt.days_per_year,
                    carry_forward: 0,
                    taken: lt.code === 'ML' ? 7 : lt.code === 'EL' ? 1 : 0,
                    pending: 0,
                    balance: lt.code === 'ML' ? 7 : lt.code === 'EL' ? 2 : lt.days_per_year
                }));
            
            const { error: lbError } = await supabase
                .from('thr_leave_balances')
                .upsert(leaveBalances, { onConflict: 'employee_id,leave_type,year' });
            
            if (lbError) {
                console.error('❌ Leave balances error:', lbError);
            } else {
                console.log('✅ Leave balances created');
            }
        }
        
        // 6. Create sample claims
        console.log('\n💳 Creating sample claims...');
        
        // Get claim type IDs
        const { data: claimTypesData } = await supabase
            .from('thr_claim_types')
            .select('id, code');
        
        if (claimTypesData) {
            const medicalType = claimTypesData.find(ct => ct.code === 'MED');
            const travelType = claimTypesData.find(ct => ct.code === 'TRV');
            
            const claims = [
                {
                    employee_id: employee.id,
                    claim_type_id: medicalType?.id,
                    claim_type: 'medical',
                    claim_no: `CLM-2024-0001`,
                    claim_date: '2024-07-10',
                    amount: 150.00,
                    description: 'Clinic visit - Dr. Ahmad',
                    status: 'approved',
                    approved_by: employee.id,
                    approved_date: '2024-07-11T10:00:00Z',
                    approved_amount: 150.00
                },
                {
                    employee_id: employee.id,
                    claim_type_id: travelType?.id,
                    claim_type: 'travel',
                    claim_no: `CLM-2024-0002`,
                    claim_date: '2024-07-12',
                    amount: 450.00,
                    description: 'Client meeting in Penang - flight and accommodation',
                    status: 'pending'
                }
            ];
            
            const { error: clError } = await supabase
                .from('thr_claims')
                .upsert(claims, { onConflict: 'claim_no' });
            
            if (clError) {
                console.error('❌ Claims error:', clError);
            } else {
                console.log('✅ Claims created');
            }
        }
        
        // 7. Create sample assets
        console.log('\n🖥️ Creating sample assets...');
        
        // Get category IDs
        const { data: categoriesData } = await supabase
            .from('thr_asset_categories')
            .select('id, code');
        
        if (categoriesData) {
            const itCategory = categoriesData.find(c => c.code === 'IT');
            const furCategory = categoriesData.find(c => c.code === 'FUR');
            
            const assets = [
                {
                    asset_no: 'IT-2024-001',
                    name: 'MacBook Pro 16"',
                    description: '16-inch MacBook Pro, M3 Max, 64GB RAM, 2TB SSD',
                    category_id: itCategory?.id,
                    brand: 'Apple',
                    model: 'MacBook Pro 16-inch 2024',
                    serial_no: 'C02XG2JHMD6N',
                    purchase_date: '2024-01-15',
                    purchase_price: 12000.00,
                    current_value: 11000.00,
                    status: 'assigned',
                    condition: 'excellent',
                    warranty_expiry: '2027-01-15'
                },
                {
                    asset_no: 'FUR-2024-055',
                    name: 'Ergonomic Office Chair',
                    description: 'Herman Miller Aeron Chair, Size B',
                    category_id: furCategory?.id,
                    brand: 'Herman Miller',
                    model: 'Aeron',
                    purchase_date: '2024-01-20',
                    purchase_price: 1500.00,
                    current_value: 1400.00,
                    status: 'assigned',
                    condition: 'excellent'
                }
            ];
            
            for (const asset of assets) {
                const { data: assetData, error: asError } = await supabase
                    .from('thr_assets')
                    .upsert(asset, { onConflict: 'asset_no' })
                    .select()
                    .single();
                
                if (!asError && assetData) {
                    // Create assignment
                    const assignment = {
                        asset_id: assetData.id,
                        employee_id: employee.id,
                        assigned_date: asset.purchase_date,
                        status: 'active',
                        condition_on_assign: 'excellent',
                        notes: 'Initial assignment to CEO'
                    };
                    
                    const { error: aaError } = await supabase
                        .from('thr_asset_assignments')
                        .upsert(assignment, { onConflict: 'asset_id,employee_id,assigned_date' });
                    
                    if (!aaError) {
                        console.log(`✅ ${asset.name} assigned`);
                    }
                }
            }
        }
        
        // 8. Create some leave requests
        console.log('\n📅 Creating sample leave requests...');
        
        const { data: alType } = await supabase
            .from('thr_leave_types')
            .select('id')
            .eq('code', 'AL')
            .single();
        
        if (alType) {
            const leaveRequests = [
                {
                    employee_id: employee.id,
                    leave_type_id: alType.id,
                    start_date: '2024-08-15',
                    end_date: '2024-08-16',
                    days: 2,
                    reason: 'Family vacation',
                    status: 'pending'
                }
            ];
            
            const { error: lrError } = await supabase
                .from('thr_leave_requests')
                .insert(leaveRequests);
            
            if (!lrError) {
                console.log('✅ Leave request created');
            }
        }
        
        console.log('\n✨ All tables populated successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

populateAllTables().catch(console.error);