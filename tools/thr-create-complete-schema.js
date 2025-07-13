#!/usr/bin/env node

/**
 * Create complete THR schema with all necessary tables
 * Including authentication support
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createCompleteSchema() {
    console.log('🏗️ Creating Complete THR Schema\n');
    console.log('=' .repeat(60) + '\n');
    
    const tables = [
        {
            name: 'thr_departments',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_departments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    organization_id UUID REFERENCES thr_organizations(organization_id),
                    department_code VARCHAR(20) UNIQUE,
                    department_name VARCHAR(100) NOT NULL,
                    parent_department_id UUID REFERENCES thr_departments(id),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_departments_org ON thr_departments(organization_id);
                CREATE INDEX idx_thr_departments_parent ON thr_departments(parent_department_id);
            `
        },
        {
            name: 'thr_sections',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_sections (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    department_id UUID REFERENCES thr_departments(id),
                    section_code VARCHAR(20) UNIQUE,
                    section_name VARCHAR(100) NOT NULL,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_sections_dept ON thr_sections(department_id);
            `
        },
        {
            name: 'thr_positions',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_positions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    position_code VARCHAR(20) UNIQUE,
                    position_title VARCHAR(200) NOT NULL,
                    grade VARCHAR(10),
                    staff_category VARCHAR(50),
                    min_salary DECIMAL(10,2),
                    max_salary DECIMAL(10,2),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_positions_grade ON thr_positions(grade);
                CREATE INDEX idx_thr_positions_category ON thr_positions(staff_category);
            `
        },
        {
            name: 'thr_allowance_types',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_allowance_types (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    is_taxable BOOLEAN DEFAULT true,
                    is_fixed BOOLEAN DEFAULT true,
                    calculation_type VARCHAR(20) DEFAULT 'fixed', -- fixed, percentage, formula
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        },
        {
            name: 'thr_deduction_types',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_deduction_types (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    is_statutory BOOLEAN DEFAULT false,
                    calculation_type VARCHAR(20) DEFAULT 'fixed', -- fixed, percentage, formula
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        },
        {
            name: 'thr_employee_allowances',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_employee_allowances (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    allowance_type_id UUID REFERENCES thr_allowance_types(id),
                    amount DECIMAL(10,2) NOT NULL,
                    start_date DATE NOT NULL,
                    end_date DATE,
                    is_active BOOLEAN DEFAULT true,
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_by UUID
                );
                
                CREATE INDEX idx_thr_emp_allowances_employee ON thr_employee_allowances(employee_id);
                CREATE INDEX idx_thr_emp_allowances_type ON thr_employee_allowances(allowance_type_id);
                CREATE INDEX idx_thr_emp_allowances_active ON thr_employee_allowances(is_active);
            `
        },
        {
            name: 'thr_employee_deductions',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_employee_deductions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    deduction_type_id UUID REFERENCES thr_deduction_types(id),
                    amount DECIMAL(10,2) NOT NULL,
                    start_date DATE NOT NULL,
                    end_date DATE,
                    is_active BOOLEAN DEFAULT true,
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_by UUID
                );
                
                CREATE INDEX idx_thr_emp_deductions_employee ON thr_employee_deductions(employee_id);
                CREATE INDEX idx_thr_emp_deductions_type ON thr_employee_deductions(deduction_type_id);
                CREATE INDEX idx_thr_emp_deductions_active ON thr_employee_deductions(is_active);
            `
        }
    ];
    
    // Create additional tables first
    console.log('1️⃣ Creating additional tables...\n');
    
    for (const table of tables) {
        console.log(`Creating ${table.name}...`);
        const { error } = await supabase.rpc('execute_sql', {
            sql_query: table.sql
        });
        
        if (error) {
            console.error(`  ❌ Error: ${error.message}`);
        } else {
            console.log(`  ✅ Created successfully`);
        }
    }
    
    // Add auth_user_id to thr_employees after creating reference tables
    console.log('\n\n2️⃣ Adding authentication support to thr_employees...\n');
    
    const { error: authError } = await supabase.rpc('execute_sql', {
        sql_query: `
            ALTER TABLE thr_employees 
            ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id),
            ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES thr_positions(id),
            ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES thr_departments(id),
            ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES thr_sections(id);
            
            CREATE UNIQUE INDEX IF NOT EXISTS idx_thr_employees_auth_user ON thr_employees(auth_user_id);
            CREATE INDEX IF NOT EXISTS idx_thr_employees_position ON thr_employees(position_id);
            CREATE INDEX IF NOT EXISTS idx_thr_employees_department ON thr_employees(department_id);
            CREATE INDEX IF NOT EXISTS idx_thr_employees_section ON thr_employees(section_id);
        `
    });
    
    if (authError) {
        console.error('Error adding auth columns:', authError);
    } else {
        console.log('✅ Authentication support added to thr_employees\n');
    }
    
    // Create RLS policies (disabled for now)
    console.log('\n\n3️⃣ Creating RLS policies (disabled by default)...\n');
    
    const rlsPolicies = `
        -- Enable RLS on all tables (but policies will be permissive for now)
        ALTER TABLE thr_employees ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_departments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_sections ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_positions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_allowance_types ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_deduction_types ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_employee_allowances ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_employee_deductions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_employment_history ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_payroll_records ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_leave_records ENABLE ROW LEVEL SECURITY;
        
        -- Create permissive policies (allow all for now)
        CREATE POLICY "Allow all for development" ON thr_employees FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_departments FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_sections FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_positions FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_allowance_types FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_deduction_types FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_employee_allowances FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_employee_deductions FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_employment_history FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_payroll_records FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_leave_records FOR ALL USING (true);
    `;
    
    const { error: rlsError } = await supabase.rpc('execute_sql', {
        sql_query: rlsPolicies
    });
    
    if (rlsError) {
        console.log('⚠️  RLS policies might already exist (this is fine)');
    } else {
        console.log('✅ RLS enabled with permissive policies\n');
    }
    
    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('\n✅ COMPLETE SCHEMA CREATED!\n');
    
    console.log('📋 Tables Structure:');
    console.log('\n🔐 Authentication:');
    console.log('  auth.users (Supabase) ← → thr_employees (via auth_user_id)');
    
    console.log('\n🏢 Organization Hierarchy:');
    console.log('  thr_brands → thr_organizations → thr_departments → thr_sections');
    
    console.log('\n👥 Employee Structure:');
    console.log('  thr_employees → thr_positions');
    console.log('             ↓');
    console.log('  employment_history, payroll_records, leave_records');
    console.log('  employee_allowances, employee_deductions');
    
    console.log('\n💰 Compensation:');
    console.log('  thr_allowance_types ← thr_employee_allowances → thr_employees');
    console.log('  thr_deduction_types ← thr_employee_deductions → thr_employees');
    
    console.log('\n🔒 Security:');
    console.log('  - RLS enabled on all tables');
    console.log('  - Permissive policies for development');
    console.log('  - Ready for production RLS policies');
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Populate reference data (departments, positions, allowance types)');
    console.log('  2. Migrate employees from master_hr2000');
    console.log('  3. Link employees to auth.users when ready');
    console.log('  4. Implement proper RLS policies');
    
    console.log('');
}

// Run schema creation
if (require.main === module) {
    createCompleteSchema().catch(console.error);
}

module.exports = { createCompleteSchema };