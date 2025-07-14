#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function fixAIAccess() {
    console.log('🔧 Fixing AI Access for Neo...\n');
    
    try {
        // 1. Update Neo's access level
        const { data: neo } = await supabase
            .from('thr_employees')
            .select('id, full_name, access_level, employee_no')
            .eq('employee_no', 'TS001')
            .single();
        
        if (neo) {
            console.log(`Found: ${neo.full_name}`);
            console.log(`Current access level: ${neo.access_level}`);
            
            if (neo.access_level < 8) {
                const { error } = await supabase
                    .from('thr_employees')
                    .update({ access_level: 8 })
                    .eq('id', neo.id);
                
                if (!error) {
                    console.log('✅ Updated to access level 8 (System Administrator)');
                }
            } else {
                console.log('✅ Already has level 8 access');
            }
        }
        
        // 2. Ensure AI is enabled globally
        console.log('\nUpdating AI settings...');
        
        // Check if settings table exists and has data
        const { data: existingSettings } = await supabase
            .from('thr_system_settings')
            .select('key')
            .limit(1);
        
        if (!existingSettings || existingSettings.length === 0) {
            console.log('Creating system settings...');
            
            // Insert all default settings
            const settings = [
                {
                    key: 'ai_enabled',
                    value: 'true',
                    description: 'Global AI features toggle',
                    data_type: 'boolean',
                    is_public: false
                },
                {
                    key: 'ai_access_levels',
                    value: JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8]),
                    description: 'Access levels allowed to use AI features',
                    data_type: 'array',
                    is_public: false
                },
                {
                    key: 'ai_daily_limit',
                    value: '100',
                    description: 'Daily AI query limit per user',
                    data_type: 'number',
                    is_public: false
                }
            ];
            
            for (const setting of settings) {
                const { error } = await supabase
                    .from('thr_system_settings')
                    .insert(setting);
                
                if (!error) {
                    console.log(`✅ Created setting: ${setting.key}`);
                } else {
                    console.log(`⚠️  Error with ${setting.key}:`, error.message);
                }
            }
        } else {
            // Update existing settings
            await supabase
                .from('thr_system_settings')
                .upsert({
                    key: 'ai_enabled',
                    value: 'true'
                }, { onConflict: 'key' });
            
            await supabase
                .from('thr_system_settings')
                .upsert({
                    key: 'ai_access_levels',
                    value: JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8])
                }, { onConflict: 'key' });
            
            console.log('✅ AI settings updated');
        }
        
        // 3. Verify the settings
        console.log('\nVerifying AI access...');
        const { data: aiEnabled } = await supabase
            .from('thr_system_settings')
            .select('value')
            .eq('key', 'ai_enabled')
            .single();
        
        const { data: aiLevels } = await supabase
            .from('thr_system_settings')
            .select('value')
            .eq('key', 'ai_access_levels')
            .single();
        
        console.log('AI Enabled:', aiEnabled?.value || 'Not set');
        console.log('Allowed Levels:', aiLevels?.value || 'Not set');
        
        console.log('\n✅ AI access should now be working for you!');
        console.log('🔄 Please refresh your browser to see the changes.');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

fixAIAccess().catch(console.error);