#!/usr/bin/env node

/**
 * THR Database Cleanup - Phase 3
 * Consolidates employment timeline into JSONB format
 * Includes all employment-related dates
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function consolidateEmploymentTimeline() {
    console.log('📅 Phase 3: Consolidating Employment Timeline\n');
    
    // First, add the new employment_timeline column if it doesn't exist
    console.log('1️⃣ Adding employment_timeline JSONB column...');
    
    const { error: alterError } = await supabase.rpc('execute_sql', {
        sql_query: `
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'master_hr2000' 
                    AND column_name = 'employment_timeline'
                ) THEN
                    ALTER TABLE master_hr2000 ADD COLUMN employment_timeline JSONB;
                END IF;
            END $$;
        `
    });
    
    if (alterError) {
        console.error('Error adding column:', alterError);
        return;
    }
    
    console.log('✅ Column added/verified\n');
    
    // Get all employees with employment dates
    console.log('2️⃣ Fetching employee timeline data...');
    const { data: employees, error: fetchError } = await supabase
        .from('master_hr2000')
        .select(`
            id,
            employee_no,
            employment_date,
            confirmation_date,
            resign_date,
            active_status
        `);
    
    if (fetchError) {
        console.error('Error fetching employees:', fetchError);
        return;
    }
    
    console.log(`Found ${employees.length} employees to process\n`);
    
    // Process each employee
    console.log('3️⃣ Consolidating employment timeline...');
    let processed = 0;
    let hasData = 0;
    
    for (const emp of employees) {
        // Build employment_timeline object
        const timeline = {};
        
        // Hire date (employment_date)
        if (emp.employment_date) {
            timeline.hire_date = emp.employment_date;
            
            // Calculate tenure
            const hireDate = new Date(emp.employment_date);
            const endDate = emp.resign_date ? new Date(emp.resign_date) : new Date();
            const tenureYears = (endDate - hireDate) / (365.25 * 24 * 60 * 60 * 1000);
            timeline.tenure_years = parseFloat(tenureYears.toFixed(2));
        }
        
        // Confirmation date
        if (emp.confirmation_date) {
            timeline.confirmation_date = emp.confirmation_date;
            
            // Calculate probation period if both dates exist
            if (emp.employment_date) {
                const hireDate = new Date(emp.employment_date);
                const confirmDate = new Date(emp.confirmation_date);
                const probationMonths = (confirmDate - hireDate) / (30.44 * 24 * 60 * 60 * 1000);
                timeline.probation_months = parseFloat(probationMonths.toFixed(1));
            }
        }
        
        // Resignation date
        if (emp.resign_date) {
            timeline.resign_date = emp.resign_date;
            timeline.last_working_date = emp.resign_date; // Assuming same as resign date
        }
        
        // Employment status
        timeline.employment_status = emp.active_status ? 'active' : 'inactive';
        if (emp.resign_date) {
            timeline.employment_status = 'resigned';
        }
        
        // Calculate retirement date (assuming age 60)
        // We'll need DOB for accurate calculation, but for now use a placeholder
        if (emp.employment_date && !emp.resign_date) {
            const hireDate = new Date(emp.employment_date);
            const retireDate = new Date(hireDate);
            retireDate.setFullYear(retireDate.getFullYear() + 35); // Rough estimate
            timeline.estimated_retire_date = retireDate.toISOString().split('T')[0];
        }
        
        // Only update if there's timeline data
        if (Object.keys(timeline).length > 0) {
            const { error: updateError } = await supabase
                .from('master_hr2000')
                .update({ 
                    employment_timeline: timeline,
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
    console.log(`  - With timeline data: ${hasData}`);
    console.log(`  - No timeline info: ${processed - hasData}`);
    
    // Statistics
    const { data: stats } = await supabase
        .from('master_hr2000')
        .select('employment_date, confirmation_date, resign_date, active_status');
    
    if (stats) {
        const hasEmploymentDate = stats.filter(s => s.employment_date).length;
        const hasConfirmationDate = stats.filter(s => s.confirmation_date).length;
        const hasResignDate = stats.filter(s => s.resign_date).length;
        const isActive = stats.filter(s => s.active_status).length;
        
        console.log('\n📊 Data Statistics:');
        console.log(`  - Employment dates: ${hasEmploymentDate}`);
        console.log(`  - Confirmation dates: ${hasConfirmationDate}`);
        console.log(`  - Resignation dates: ${hasResignDate}`);
        console.log(`  - Active employees: ${isActive}`);
    }
    
    // Verify the consolidation
    console.log('\n4️⃣ Verifying consolidation...');
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, employment_timeline')
        .not('employment_timeline', 'is', null)
        .limit(3);
    
    if (!sampleError && samples) {
        console.log('\n📋 Sample employment_timeline records:');
        samples.forEach(emp => {
            console.log(`\n${emp.employee_no}:`, JSON.stringify(emp.employment_timeline, null, 2));
        });
    }
    
    console.log('\n✅ Phase 3 Complete!');
    console.log('\n⚠️  Original columns preserved. To remove them after verification:');
    console.log('```sql');
    console.log('ALTER TABLE master_hr2000');
    console.log('DROP COLUMN employment_date,');
    console.log('DROP COLUMN confirmation_date,');
    console.log('DROP COLUMN resign_date;');
    console.log('-- Note: Keep active_status as it\'s a key operational field');
    console.log('```');
}

// Run consolidation
if (require.main === module) {
    consolidateEmploymentTimeline().catch(console.error);
}

module.exports = { consolidateEmploymentTimeline };