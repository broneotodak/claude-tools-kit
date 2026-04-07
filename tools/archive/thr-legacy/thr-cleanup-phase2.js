#!/usr/bin/env node

/**
 * THR Database Cleanup - Phase 2
 * Consolidates bank information into JSONB format
 * Merges with existing bank_branch JSONB
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function consolidateBankInfo() {
    console.log('🏦 Phase 2: Consolidating Bank Information\n');
    
    // First, add the new bank_info column if it doesn't exist
    console.log('1️⃣ Adding bank_info JSONB column...');
    
    const { error: alterError } = await supabase.rpc('execute_sql', {
        sql_query: `
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'master_hr2000' 
                    AND column_name = 'bank_info'
                ) THEN
                    ALTER TABLE master_hr2000 ADD COLUMN bank_info JSONB;
                END IF;
            END $$;
        `
    });
    
    if (alterError) {
        console.error('Error adding column:', alterError);
        return;
    }
    
    console.log('✅ Column added/verified\n');
    
    // Get all employees with bank data
    console.log('2️⃣ Fetching employee bank data...');
    const { data: employees, error: fetchError } = await supabase
        .from('master_hr2000')
        .select(`
            id,
            employee_no,
            bank_name,
            bank_acc_no,
            bank_branch
        `);
    
    if (fetchError) {
        console.error('Error fetching employees:', fetchError);
        return;
    }
    
    console.log(`Found ${employees.length} employees to process\n`);
    
    // Process each employee
    console.log('3️⃣ Consolidating bank information...');
    let processed = 0;
    let hasData = 0;
    
    for (const emp of employees) {
        // Build bank_info object
        const bankInfo = {};
        
        // Bank name
        if (emp.bank_name) {
            bankInfo.bank_name = emp.bank_name;
            
            // Try to extract bank code from bank_name
            const bankCodeMatch = emp.bank_name.match(/^([A-Z]+)\//);
            if (bankCodeMatch) {
                bankInfo.bank_code = bankCodeMatch[1];
            }
        }
        
        // Account number
        if (emp.bank_acc_no) {
            bankInfo.account_no = emp.bank_acc_no;
        }
        
        // Merge existing bank_branch data if it exists
        if (emp.bank_branch && typeof emp.bank_branch === 'object') {
            // Merge the existing JSONB data
            Object.assign(bankInfo, emp.bank_branch);
        }
        
        // Payment details from raw data (if we captured them)
        // These would come from the migration data
        bankInfo.payment_type = 'MONTHLY'; // Standard from raw data
        bankInfo.payment_frequency = 'ONCE PER MONTH';
        bankInfo.payment_via = 'BANK';
        
        // Only update if there's bank data
        if (Object.keys(bankInfo).length > 0) {
            const { error: updateError } = await supabase
                .from('master_hr2000')
                .update({ 
                    bank_info: bankInfo,
                    updated_at: new Date().toISOString()
                })
                .eq('id', emp.id);
            
            if (updateError) {
                console.error(`Error updating ${emp.employee_no}:`, updateError);
            } else {
                hasData++;
            }
        }
        
        processed++;
        if (processed % 50 === 0) {
            console.log(`  Processed ${processed}/${employees.length} employees...`);
        }
    }
    
    console.log(`\n✅ Consolidation complete!`);
    console.log(`  - Total processed: ${processed}`);
    console.log(`  - With bank data: ${hasData}`);
    console.log(`  - No bank info: ${processed - hasData}`);
    
    // Verify the consolidation
    console.log('\n4️⃣ Verifying consolidation...');
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, bank_info')
        .not('bank_info', 'is', null)
        .limit(3);
    
    if (!sampleError && samples) {
        console.log('\n📋 Sample bank_info records:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}:`, JSON.stringify(emp.bank_info, null, 2));
        });
    }
    
    // Check how many have bank_branch that needs merging
    const { count: branchCount } = await supabase
        .from('master_hr2000')
        .select('*', { count: 'exact', head: true })
        .not('bank_branch', 'is', null);
    
    console.log(`\n📊 Bank branch data: ${branchCount} records have existing bank_branch JSONB`);
    
    console.log('\n✅ Phase 2 Complete!');
    console.log('\n⚠️  Original columns preserved. To remove them after verification:');
    console.log('```sql');
    console.log('ALTER TABLE master_hr2000');
    console.log('DROP COLUMN bank_name,');
    console.log('DROP COLUMN bank_acc_no,');
    console.log('DROP COLUMN bank_branch;');
    console.log('```');
}

// Run consolidation
if (require.main === module) {
    consolidateBankInfo().catch(console.error);
}

module.exports = { consolidateBankInfo };