#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkAccessLevels() {
    console.log('🔐 Checking Access Levels...\n');
    
    try {
        // Check if access levels exist
        const { data: levels, error } = await supabase
            .from('thr_access_levels')
            .select('*')
            .order('level');
        
        if (error) {
            console.error('❌ Error:', error);
            return;
        }
        
        if (!levels || levels.length === 0) {
            console.log('⚠️  No access levels found. Creating default levels...');
            
            const defaultLevels = [
                { level: 0, name: 'Employee', description: 'Basic employee access' },
                { level: 1, name: 'Senior Employee', description: 'Senior employee with limited privileges' },
                { level: 2, name: 'Team Lead', description: 'Team lead with team view access' },
                { level: 3, name: 'Supervisor', description: 'Supervisor with department view' },
                { level: 4, name: 'Assistant Manager', description: 'Assistant manager with limited management access' },
                { level: 5, name: 'Manager', description: 'Manager with full department access' },
                { level: 6, name: 'Senior Manager', description: 'Senior manager with cross-department access' },
                { level: 7, name: 'HR Administrator', description: 'Full HR system access' },
                { level: 8, name: 'System Administrator', description: 'Complete system control and configuration' },
            ];
            
            const { error: insertError } = await supabase
                .from('thr_access_levels')
                .insert(defaultLevels);
            
            if (insertError) {
                console.error('❌ Failed to create levels:', insertError);
            } else {
                console.log('✅ Created default access levels');
            }
        } else {
            console.log('✅ Found access levels:');
            levels.forEach(level => {
                console.log(`  Level ${level.level}: ${level.name} - ${level.description}`);
            });
        }
        
        // Check Neo's access level
        console.log('\n🔍 Checking Neo\'s access level...');
        const { data: neo } = await supabase
            .from('thr_employees')
            .select('full_name, access_level')
            .eq('employee_no', 'TS001')
            .single();
        
        if (neo) {
            console.log(`✅ ${neo.full_name} has access level: ${neo.access_level}`);
            
            if (neo.access_level < 7) {
                console.log('\n⚠️  Updating Neo to level 8 (System Administrator)...');
                
                const { error: updateError } = await supabase
                    .from('thr_employees')
                    .update({ access_level: 8 })
                    .eq('employee_no', 'TS001');
                
                if (!updateError) {
                    console.log('✅ Updated to level 8');
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

checkAccessLevels().catch(console.error);