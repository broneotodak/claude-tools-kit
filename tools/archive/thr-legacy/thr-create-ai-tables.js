#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createAITables() {
    console.log('🤖 Creating AI Integration Tables...\n');
    
    try {
        // 1. Create AI conversations table
        console.log('Creating thr_ai_conversations...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_ai_conversations (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    message TEXT NOT NULL,
                    intent VARCHAR(100),
                    entities JSONB DEFAULT '{}'::jsonb,
                    response JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_ai_conversations_employee ON thr_ai_conversations(employee_id);
                CREATE INDEX IF NOT EXISTS idx_ai_conversations_intent ON thr_ai_conversations(intent);
            `
        });
        
        // 2. Create AI saved views table
        console.log('Creating thr_ai_saved_views...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_ai_saved_views (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    view_type VARCHAR(50),
                    component_code TEXT,
                    parameters JSONB DEFAULT '{}'::jsonb,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    is_favorite BOOLEAN DEFAULT false,
                    is_active BOOLEAN DEFAULT true,
                    custom_name VARCHAR(100),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_ai_saved_views_employee ON thr_ai_saved_views(employee_id);
                CREATE INDEX IF NOT EXISTS idx_ai_saved_views_favorite ON thr_ai_saved_views(is_favorite) WHERE is_favorite = true;
            `
        });
        
        // 3. Create system settings table
        console.log('Creating thr_system_settings...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_system_settings (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    key VARCHAR(100) UNIQUE NOT NULL,
                    value TEXT,
                    description TEXT,
                    data_type VARCHAR(20) DEFAULT 'string',
                    is_public BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_by UUID REFERENCES thr_employees(id)
                );
            `
        });
        
        // 4. Insert default AI settings
        console.log('\nInserting default AI settings...');
        const defaultSettings = [
            {
                key: 'ai_enabled',
                value: 'true',
                description: 'Global AI features toggle',
                data_type: 'boolean',
                is_public: false,
            },
            {
                key: 'ai_access_levels',
                value: JSON.stringify([3, 4, 5, 6, 7, 8]),
                description: 'Access levels allowed to use AI features',
                data_type: 'array',
                is_public: false,
            },
            {
                key: 'ai_daily_limit',
                value: '50',
                description: 'Daily AI query limit per user',
                data_type: 'number',
                is_public: false,
            },
            {
                key: 'ai_model_preference',
                value: 'balanced',
                description: 'AI model preference: fast, balanced, or accurate',
                data_type: 'string',
                is_public: false,
            },
        ];
        
        for (const setting of defaultSettings) {
            const { error } = await supabase
                .from('thr_system_settings')
                .upsert(setting, { onConflict: 'key' });
            
            if (error) {
                console.error(`Error inserting setting ${setting.key}:`, error);
            }
        }
        
        console.log('\n✅ AI tables created successfully!');
        
        // 5. Create AI usage tracking table
        console.log('\nCreating thr_ai_usage...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_ai_usage (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    usage_date DATE DEFAULT CURRENT_DATE,
                    query_count INTEGER DEFAULT 1,
                    tokens_used INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(employee_id, usage_date)
                );
                
                CREATE INDEX IF NOT EXISTS idx_ai_usage_employee_date ON thr_ai_usage(employee_id, usage_date);
            `
        });
        
        console.log('✅ AI usage tracking table created!');
        
    } catch (error) {
        console.error('❌ Error creating AI tables:', error);
    }
}

createAITables().catch(console.error);