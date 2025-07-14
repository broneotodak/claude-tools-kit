#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createPayrollTables() {
    console.log('💰 Creating Payroll Tables...\n');
    
    try {
        // 1. Create salary components table
        console.log('Creating thr_salary_components...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_salary_components (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    type VARCHAR(20) CHECK (type IN ('earning', 'deduction', 'contribution')),
                    category VARCHAR(50), -- basic, allowance, statutory, etc.
                    is_taxable BOOLEAN DEFAULT true,
                    is_active BOOLEAN DEFAULT true,
                    calculation_type VARCHAR(20) DEFAULT 'fixed', -- fixed, percentage, formula
                    formula TEXT, -- for complex calculations
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `
        });
        
        // 2. Create employee salary structure
        console.log('Creating thr_employee_salary...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_employee_salary (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    component_id UUID REFERENCES thr_salary_components(id),
                    amount DECIMAL(12,2),
                    percentage DECIMAL(5,2), -- if percentage-based
                    effective_from DATE NOT NULL,
                    effective_to DATE,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(employee_id, component_id, effective_from)
                );
            `
        });
        
        // 3. Create payroll runs table
        console.log('Creating thr_payroll_runs...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_payroll_runs (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    organization_id UUID REFERENCES thr_organizations(id),
                    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
                    year INTEGER NOT NULL,
                    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'approved', 'paid')),
                    run_date DATE,
                    payment_date DATE,
                    total_gross DECIMAL(15,2),
                    total_deductions DECIMAL(15,2),
                    total_net DECIMAL(15,2),
                    created_by UUID REFERENCES thr_employees(id),
                    approved_by UUID REFERENCES thr_employees(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(organization_id, month, year)
                );
            `
        });
        
        // 4. Create payslips table
        console.log('Creating thr_payslips...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_payslips (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    payroll_run_id UUID REFERENCES thr_payroll_runs(id) ON DELETE CASCADE,
                    employee_id UUID REFERENCES thr_employees(id),
                    employee_no VARCHAR(50),
                    month INTEGER NOT NULL,
                    year INTEGER NOT NULL,
                    basic_salary DECIMAL(12,2),
                    gross_salary DECIMAL(12,2),
                    total_deductions DECIMAL(12,2),
                    net_salary DECIMAL(12,2),
                    earnings JSONB DEFAULT '{}'::jsonb,
                    deductions JSONB DEFAULT '{}'::jsonb,
                    ytd_earnings DECIMAL(12,2), -- Year to date
                    ytd_tax DECIMAL(12,2),
                    payment_method VARCHAR(20) DEFAULT 'bank',
                    bank_details JSONB,
                    is_published BOOLEAN DEFAULT false,
                    published_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(employee_id, month, year)
                );
            `
        });
        
        // 5. Create attendance table
        console.log('Creating thr_attendance...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_attendance (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    date DATE NOT NULL,
                    check_in_time TIMESTAMP WITH TIME ZONE,
                    check_out_time TIMESTAMP WITH TIME ZONE,
                    status VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'half_day', 'holiday', 'weekend', 'leave')),
                    work_hours DECIMAL(4,2),
                    overtime_hours DECIMAL(4,2),
                    location JSONB, -- GPS coordinates if needed
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(employee_id, date)
                );
            `
        });
        
        // 6. Insert default salary components
        console.log('\nInserting default salary components...');
        const components = [
            // Earnings
            { code: 'BASIC', name: 'Basic Salary', type: 'earning', category: 'basic', is_taxable: true },
            { code: 'HRA', name: 'House Rent Allowance', type: 'earning', category: 'allowance', is_taxable: true },
            { code: 'TRANSPORT', name: 'Transport Allowance', type: 'earning', category: 'allowance', is_taxable: true },
            { code: 'MEAL', name: 'Meal Allowance', type: 'earning', category: 'allowance', is_taxable: false },
            { code: 'PHONE', name: 'Phone Allowance', type: 'earning', category: 'allowance', is_taxable: true },
            { code: 'OVERTIME', name: 'Overtime Pay', type: 'earning', category: 'variable', is_taxable: true },
            { code: 'BONUS', name: 'Performance Bonus', type: 'earning', category: 'variable', is_taxable: true },
            
            // Deductions
            { code: 'EPF_EMP', name: 'EPF Employee', type: 'deduction', category: 'statutory', is_taxable: false, calculation_type: 'percentage' },
            { code: 'SOCSO_EMP', name: 'SOCSO Employee', type: 'deduction', category: 'statutory', is_taxable: false, calculation_type: 'percentage' },
            { code: 'EIS_EMP', name: 'EIS Employee', type: 'deduction', category: 'statutory', is_taxable: false, calculation_type: 'percentage' },
            { code: 'PCB', name: 'PCB/Income Tax', type: 'deduction', category: 'statutory', is_taxable: false },
            { code: 'ZAKAT', name: 'Zakat', type: 'deduction', category: 'statutory', is_taxable: false },
            { code: 'ADVANCE', name: 'Salary Advance', type: 'deduction', category: 'other', is_taxable: false },
            
            // Employer Contributions
            { code: 'EPF_EMP_C', name: 'EPF Employer', type: 'contribution', category: 'statutory', is_taxable: false, calculation_type: 'percentage' },
            { code: 'SOCSO_EMP_C', name: 'SOCSO Employer', type: 'contribution', category: 'statutory', is_taxable: false, calculation_type: 'percentage' },
            { code: 'EIS_EMP_C', name: 'EIS Employer', type: 'contribution', category: 'statutory', is_taxable: false, calculation_type: 'percentage' },
        ];
        
        for (const component of components) {
            const { error } = await supabase
                .from('thr_salary_components')
                .upsert(component, { onConflict: 'code' });
            
            if (error) {
                console.error(`Error inserting ${component.code}:`, error);
            }
        }
        
        // 7. Create indexes
        console.log('\nCreating indexes...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE INDEX IF NOT EXISTS idx_employee_salary_emp ON thr_employee_salary(employee_id);
                CREATE INDEX IF NOT EXISTS idx_employee_salary_active ON thr_employee_salary(is_active) WHERE is_active = true;
                CREATE INDEX IF NOT EXISTS idx_payslips_employee ON thr_payslips(employee_id);
                CREATE INDEX IF NOT EXISTS idx_payslips_run ON thr_payslips(payroll_run_id);
                CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON thr_attendance(employee_id, date);
                CREATE INDEX IF NOT EXISTS idx_attendance_date ON thr_attendance(date);
            `
        });
        
        console.log('\n✅ Payroll tables created successfully!');
        
    } catch (error) {
        console.error('❌ Error creating payroll tables:', error);
    }
}

createPayrollTables().catch(console.error);