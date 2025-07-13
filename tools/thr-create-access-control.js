#!/usr/bin/env node

/**
 * Create Access Control System for AI-Integrated THR
 * Enables role-based access with dynamic capabilities
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createAccessControlSystem() {
    console.log('🔐 Creating THR Access Control System\n');
    console.log('=' .repeat(60) + '\n');
    
    // Create access levels table
    const accessLevelsSQL = `
        CREATE TABLE IF NOT EXISTS thr_access_levels (
            id SERIAL PRIMARY KEY,
            level INTEGER UNIQUE NOT NULL,
            name VARCHAR(50) NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        -- Create index for fast lookups
        CREATE INDEX idx_access_levels_level ON thr_access_levels(level);
        
        -- Insert default access levels
        INSERT INTO thr_access_levels (level, name, description) VALUES
        (0, 'Employee', 'Regular employee with basic access'),
        (1, 'Head of Department', 'Department head with team management access'),
        (2, 'Manager', 'Manager with broader organizational access'),
        (3, 'Director', 'Director with strategic access'),
        (4, 'CEO', 'Chief Executive with full organizational visibility'),
        (5, 'Accounting', 'Accounting team with financial modules access'),
        (6, 'HR Admin', 'HR administrator with employee management access'),
        (7, 'System Admin', 'System administrator with configuration access'),
        (8, 'Super Admin', 'Super administrator with unrestricted access')
        ON CONFLICT (level) DO NOTHING;
    `;
    
    console.log('Creating access levels table...');
    const { error: levelsError } = await supabase.rpc('execute_sql', {
        sql_query: accessLevelsSQL
    });
    
    if (levelsError) {
        console.error('Error:', levelsError);
    } else {
        console.log('✅ Access levels table created\n');
    }
    
    // Create capabilities configuration table
    const capabilitiesSQL = `
        CREATE TABLE IF NOT EXISTS thr_access_capabilities (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            access_level INTEGER REFERENCES thr_access_levels(level),
            module VARCHAR(50) NOT NULL, -- hr, accounting, atlas, ai, system
            capabilities JSONB NOT NULL,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(access_level, module)
        );
        
        -- Create index for fast lookups
        CREATE INDEX idx_access_capabilities_level ON thr_access_capabilities(access_level);
        CREATE INDEX idx_access_capabilities_module ON thr_access_capabilities(module);
    `;
    
    console.log('Creating capabilities table...');
    await supabase.rpc('execute_sql', { sql_query: capabilitiesSQL });
    console.log('✅ Capabilities table created\n');
    
    // Add access_level to employees
    const employeeAccessSQL = `
        -- Add access_level column to employees
        ALTER TABLE thr_employees 
        ADD COLUMN IF NOT EXISTS access_level INTEGER DEFAULT 0 
        REFERENCES thr_access_levels(level);
        
        -- Add custom permissions JSONB for user-specific overrides
        ALTER TABLE thr_employees 
        ADD COLUMN IF NOT EXISTS custom_permissions JSONB DEFAULT '{}';
        
        -- Create index for access level
        CREATE INDEX IF NOT EXISTS idx_employees_access_level 
        ON thr_employees(access_level);
    `;
    
    console.log('Adding access level to employees...');
    await supabase.rpc('execute_sql', { sql_query: employeeAccessSQL });
    console.log('✅ Employee access fields added\n');
    
    // Create AI interaction tables
    const aiTablesSQL = `
        -- Store AI conversations for context
        CREATE TABLE IF NOT EXISTS thr_ai_conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id UUID REFERENCES thr_employees(id),
            session_id UUID NOT NULL,
            message_type VARCHAR(20) NOT NULL, -- user, assistant, system
            message TEXT NOT NULL,
            context JSONB, -- Store relevant context
            tokens_used INTEGER,
            model_used VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX idx_ai_conversations_employee ON thr_ai_conversations(employee_id);
        CREATE INDEX idx_ai_conversations_session ON thr_ai_conversations(session_id);
        CREATE INDEX idx_ai_conversations_created ON thr_ai_conversations(created_at);
        
        -- Store dynamically generated views
        CREATE TABLE IF NOT EXISTS thr_ai_saved_views (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id UUID REFERENCES thr_employees(id),
            view_name VARCHAR(100) NOT NULL,
            view_type VARCHAR(50), -- dashboard, report, form, chart
            prompt TEXT, -- Original user request
            component_code TEXT, -- Generated React/HTML code
            data_query TEXT, -- Generated SQL/Supabase query
            configuration JSONB, -- View settings, layout, etc.
            is_pinned BOOLEAN DEFAULT false,
            usage_count INTEGER DEFAULT 0,
            last_used TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX idx_ai_views_employee ON thr_ai_saved_views(employee_id);
        CREATE INDEX idx_ai_views_pinned ON thr_ai_saved_views(is_pinned);
        
        -- Store user preferences for AI
        CREATE TABLE IF NOT EXISTS thr_ai_preferences (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id UUID REFERENCES thr_employees(id) UNIQUE,
            preferred_language VARCHAR(10) DEFAULT 'en',
            preferred_tone VARCHAR(20) DEFAULT 'professional', -- casual, professional, concise
            dashboard_layout JSONB, -- Saved dashboard arrangement
            quick_actions JSONB, -- Frequently used commands
            ai_suggestions_enabled BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `;
    
    console.log('Creating AI integration tables...');
    await supabase.rpc('execute_sql', { sql_query: aiTablesSQL });
    console.log('✅ AI tables created\n');
    
    // Insert default capabilities
    console.log('Setting up default capabilities...\n');
    
    const defaultCapabilities = [
        // Level 0 - Employee
        {
            access_level: 0,
            module: 'hr',
            capabilities: {
                view: ['own_profile', 'own_leave_balance', 'own_claims', 'own_assets'],
                edit: ['own_profile_basic', 'own_bank_info'],
                create: ['leave_request', 'claim_request'],
                delete: [],
                special: ['view_organization_chart', 'view_public_directory']
            }
        },
        {
            access_level: 0,
            module: 'ai',
            capabilities: {
                features: ['ask_sofia', 'save_views', 'personalize_dashboard'],
                max_saved_views: 5,
                ai_models: ['gpt-3.5-turbo']
            }
        },
        
        // Level 1 - Head of Department
        {
            access_level: 1,
            module: 'hr',
            capabilities: {
                view: ['department_employees', 'department_leave_calendar', 'department_claims'],
                edit: ['department_info'],
                approve: ['department_leave_requests', 'department_claims'],
                create: ['department_announcements'],
                reports: ['department_attendance', 'department_performance']
            }
        },
        
        // Level 5 - Accounting
        {
            access_level: 5,
            module: 'accounting',
            capabilities: {
                view: ['all_claims', 'all_payroll', 'tax_tables', 'cost_centers'],
                edit: ['claim_status', 'payment_batches'],
                create: ['payment_batch', 'bank_file', 'gl_posting'],
                approve: ['claims_finance', 'payroll_run'],
                reports: ['financial_summary', 'tax_reports', 'cost_analysis']
            }
        },
        
        // Level 8 - Super Admin
        {
            access_level: 8,
            module: 'system',
            capabilities: {
                full_access: true,
                configure: ['access_levels', 'capabilities', 'system_settings'],
                impersonate: true,
                debug_mode: true,
                api_access: ['all_endpoints'],
                ai_features: ['unlimited_views', 'all_models', 'custom_prompts']
            }
        }
    ];
    
    for (const cap of defaultCapabilities) {
        const { error } = await supabase
            .from('thr_access_capabilities')
            .upsert(cap, { onConflict: 'access_level,module' });
        
        if (!error) {
            console.log(`✅ Set capabilities for level ${cap.access_level} - ${cap.module}`);
        }
    }
    
    // Create helper functions
    const helperFunctionsSQL = `
        -- Function to check if user has specific capability
        CREATE OR REPLACE FUNCTION check_user_capability(
            p_employee_id UUID,
            p_module VARCHAR,
            p_capability VARCHAR,
            p_action VARCHAR DEFAULT NULL
        ) RETURNS BOOLEAN AS $$
        DECLARE
            v_access_level INTEGER;
            v_capabilities JSONB;
            v_custom_perms JSONB;
        BEGIN
            -- Get user's access level and custom permissions
            SELECT access_level, custom_permissions 
            INTO v_access_level, v_custom_perms
            FROM thr_employees 
            WHERE id = p_employee_id;
            
            -- Check custom permissions first
            IF v_custom_perms ? p_module THEN
                IF v_custom_perms->p_module ? p_capability THEN
                    RETURN true;
                END IF;
            END IF;
            
            -- Get capabilities for user's access level
            SELECT capabilities 
            INTO v_capabilities
            FROM thr_access_capabilities
            WHERE access_level = v_access_level 
            AND module = p_module
            AND is_active = true;
            
            -- Check for full access
            IF v_capabilities->>'full_access' = 'true' THEN
                RETURN true;
            END IF;
            
            -- Check specific capability
            IF p_action IS NULL THEN
                RETURN v_capabilities ? p_capability;
            ELSE
                RETURN v_capabilities->p_capability ? p_action;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        
        -- Function to get user's accessible data scope
        CREATE OR REPLACE FUNCTION get_user_data_scope(
            p_employee_id UUID
        ) RETURNS JSONB AS $$
        DECLARE
            v_access_level INTEGER;
            v_org_id UUID;
            v_dept_id UUID;
            v_scope JSONB;
        BEGIN
            SELECT access_level, organization_id, department_id
            INTO v_access_level, v_org_id, v_dept_id
            FROM thr_employees
            WHERE id = p_employee_id;
            
            -- Build scope based on access level
            CASE v_access_level
                WHEN 0 THEN -- Employee
                    v_scope = jsonb_build_object(
                        'employee_ids', jsonb_build_array(p_employee_id),
                        'scope', 'self'
                    );
                WHEN 1 THEN -- Head of Department
                    v_scope = jsonb_build_object(
                        'department_ids', jsonb_build_array(v_dept_id),
                        'scope', 'department'
                    );
                WHEN 2, 3 THEN -- Manager/Director
                    v_scope = jsonb_build_object(
                        'organization_ids', jsonb_build_array(v_org_id),
                        'scope', 'organization'
                    );
                ELSE -- Higher levels
                    v_scope = jsonb_build_object(
                        'scope', 'all'
                    );
            END CASE;
            
            RETURN v_scope;
        END;
        $$ LANGUAGE plpgsql;
    `;
    
    console.log('\nCreating helper functions...');
    await supabase.rpc('execute_sql', { sql_query: helperFunctionsSQL });
    console.log('✅ Helper functions created\n');
    
    // Create AI-friendly view
    const aiViewSQL = `
        CREATE OR REPLACE VIEW thr_ai_employee_context AS
        SELECT 
            e.id as employee_id,
            e.employee_no,
            e.full_name,
            e.access_level,
            al.name as access_level_name,
            e.organization_id,
            ev.nickname,
            ev.email,
            ev.organization_name,
            ev.position_name,
            ev.department_name,
            -- Aggregate capabilities
            (
                SELECT jsonb_object_agg(module, capabilities)
                FROM thr_access_capabilities
                WHERE access_level = e.access_level
                AND is_active = true
            ) as capabilities,
            e.custom_permissions,
            -- Data scope
            get_user_data_scope(e.id) as data_scope
        FROM thr_employees e
        JOIN thr_access_levels al ON e.access_level = al.level
        LEFT JOIN thr_employees_view ev ON e.id = ev.employee_id
        WHERE e.employment_status = 'active';
    `;
    
    await supabase.rpc('execute_sql', { sql_query: aiViewSQL });
    console.log('✅ AI context view created\n');
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ ACCESS CONTROL SYSTEM CREATED!\n');
    
    console.log('🏗️ Architecture Overview:\n');
    console.log('1. Access Levels (0-8):');
    console.log('   0 = Employee (self only)');
    console.log('   1 = Head of Department');
    console.log('   2 = Manager');
    console.log('   3 = Director');
    console.log('   4 = CEO');
    console.log('   5 = Accounting');
    console.log('   6 = HR Admin');
    console.log('   7 = System Admin');
    console.log('   8 = Super Admin\n');
    
    console.log('2. Capability System:');
    console.log('   - Module-based (hr, accounting, atlas, ai, system)');
    console.log('   - Action-based (view, edit, create, delete, approve)');
    console.log('   - JSONB for flexible configuration');
    console.log('   - Custom permissions per employee\n');
    
    console.log('3. AI Integration:');
    console.log('   - Conversation history tracking');
    console.log('   - Dynamic view generation & storage');
    console.log('   - User preferences');
    console.log('   - Context-aware responses\n');
    
    console.log('🤖 AI Agent (Sofia) Flow:');
    console.log('   1. User asks: "Show my leave balance"');
    console.log('   2. Check user capabilities via thr_ai_employee_context');
    console.log('   3. OpenAI understands intent + access scope');
    console.log('   4. Claude generates appropriate view/query');
    console.log('   5. Execute query with user\'s data scope');
    console.log('   6. Render dynamic UI component');
    console.log('   7. User can save view to dashboard\n');
    
    console.log('⚡ Next Steps:');
    console.log('   1. Assign access levels to employees');
    console.log('   2. Configure module capabilities');
    console.log('   3. Build AI agent endpoints');
    console.log('   4. Create dynamic UI renderer');
    console.log('   5. Implement view builder AI\n');
}

// Run
if (require.main === module) {
    createAccessControlSystem().catch(console.error);
}

module.exports = { createAccessControlSystem };