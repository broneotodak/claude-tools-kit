#!/usr/bin/env node

/**
 * THR Database Cleanup - Phase 4
 * Consolidates tax and statutory information into JSONB format
 * Combines all tax-related fields
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function consolidateTaxInfo() {
    console.log('🏛️ Phase 4: Consolidating Tax & Statutory Information\n');
    
    // First, add the new tax_info column if it doesn't exist
    console.log('1️⃣ Adding tax_info JSONB column...');
    
    const { error: alterError } = await supabase.rpc('execute_sql', {
        sql_query: `
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'master_hr2000' 
                    AND column_name = 'tax_info'
                ) THEN
                    ALTER TABLE master_hr2000 ADD COLUMN tax_info JSONB;
                END IF;
            END $$;
        `
    });
    
    if (alterError) {
        console.error('Error adding column:', alterError);
        return;
    }
    
    console.log('✅ Column added/verified\n');
    
    // Get all employees with tax data
    console.log('2️⃣ Fetching employee tax data...');
    const { data: employees, error: fetchError } = await supabase
        .from('master_hr2000')
        .select(`
            id,
            employee_no,
            lhdn_no,
            income_tax_branch,
            pcb,
            ea_form,
            epf_no,
            epf_group,
            socso_no,
            perkeso_code,
            socso_group,
            eis_group,
            kwsp_no,
            ptptn_no
        `);
    
    if (fetchError) {
        console.error('Error fetching employees:', fetchError);
        return;
    }
    
    console.log(`Found ${employees.length} employees to process\n`);
    
    // Process each employee
    console.log('3️⃣ Consolidating tax information...');
    let processed = 0;
    let hasData = 0;
    
    for (const emp of employees) {
        // Build tax_info object
        const taxInfo = {};
        
        // LHDN (Income Tax)
        if (emp.lhdn_no || emp.income_tax_branch || emp.pcb || emp.ea_form) {
            taxInfo.income_tax = {};
            if (emp.lhdn_no) taxInfo.income_tax.tax_no = emp.lhdn_no;
            if (emp.income_tax_branch) taxInfo.income_tax.branch = emp.income_tax_branch;
            if (emp.pcb) taxInfo.income_tax.pcb_code = emp.pcb.toString();
            if (emp.ea_form) taxInfo.income_tax.ea_form = emp.ea_form;
        }
        
        // EPF/KWSP (same thing - kwsp_no might have the actual EPF number)
        if (emp.epf_no || emp.epf_group || emp.kwsp_no) {
            taxInfo.epf = {};
            // Use kwsp_no if available, otherwise epf_no
            if (emp.kwsp_no) {
                taxInfo.epf.account_no = emp.kwsp_no;
            } else if (emp.epf_no) {
                taxInfo.epf.account_no = emp.epf_no;
            }
            if (emp.epf_group) taxInfo.epf.group = emp.epf_group;
        }
        
        // SOCSO/PERKESO (same thing)
        if (emp.socso_no || emp.perkeso_code || emp.socso_group) {
            taxInfo.socso = {};
            // Use perkeso_code if available (it's the actual SOCSO number)
            if (emp.perkeso_code) {
                taxInfo.socso.account_no = emp.perkeso_code;
            } else if (emp.socso_no) {
                taxInfo.socso.account_no = emp.socso_no;
            }
            if (emp.socso_group) taxInfo.socso.group = emp.socso_group;
        }
        
        // EIS
        if (emp.eis_group) {
            taxInfo.eis = {
                group: emp.eis_group
            };
        }
        
        // PTPTN (Student Loan)
        if (emp.ptptn_no) {
            taxInfo.ptptn = {
                account_no: emp.ptptn_no
            };
        }
        
        // Only update if there's tax data
        if (Object.keys(taxInfo).length > 0) {
            const { error: updateError } = await supabase
                .from('master_hr2000')
                .update({ 
                    tax_info: taxInfo,
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
    console.log(`  - With tax data: ${hasData}`);
    console.log(`  - No tax info: ${processed - hasData}`);
    
    // Statistics
    const { data: stats } = await supabase
        .from('master_hr2000')
        .select('lhdn_no, epf_no, kwsp_no, perkeso_code, socso_no, ea_form');
    
    if (stats) {
        const hasLHDN = stats.filter(s => s.lhdn_no).length;
        const hasEPF = stats.filter(s => s.epf_no || s.kwsp_no).length;
        const hasSOCSO = stats.filter(s => s.perkeso_code || s.socso_no).length;
        const hasEAForm = stats.filter(s => s.ea_form).length;
        
        console.log('\n📊 Tax Data Statistics:');
        console.log(`  - Income Tax Numbers: ${hasLHDN}`);
        console.log(`  - EPF Accounts: ${hasEPF}`);
        console.log(`  - SOCSO Accounts: ${hasSOCSO}`);
        console.log(`  - EA Form assignments: ${hasEAForm}`);
    }
    
    // Verify the consolidation
    console.log('\n4️⃣ Verifying consolidation...');
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, tax_info')
        .not('tax_info', 'is', null)
        .limit(3);
    
    if (!sampleError && samples) {
        console.log('\n📋 Sample tax_info records:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}:`, JSON.stringify(emp.tax_info, null, 2));
        });
    }
    
    console.log('\n✅ Phase 4 Complete!');
    console.log('\n⚠️  Original columns preserved. To remove them after verification:');
    console.log('```sql');
    console.log('ALTER TABLE master_hr2000');
    console.log('DROP COLUMN lhdn_no,');
    console.log('DROP COLUMN income_tax_branch,');
    console.log('DROP COLUMN pcb,');
    console.log('DROP COLUMN ea_form,');
    console.log('DROP COLUMN epf_no,');
    console.log('DROP COLUMN epf_group,');
    console.log('DROP COLUMN socso_no,');
    console.log('DROP COLUMN perkeso_code,');
    console.log('DROP COLUMN socso_group,');
    console.log('DROP COLUMN eis_group,');
    console.log('DROP COLUMN kwsp_no,');
    console.log('DROP COLUMN ptptn_no;');
    console.log('```');
}

// Run consolidation
if (require.main === module) {
    consolidateTaxInfo().catch(console.error);
}

module.exports = { consolidateTaxInfo };