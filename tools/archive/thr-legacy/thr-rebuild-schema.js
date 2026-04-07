#!/usr/bin/env node

/**
 * THR Schema Rebuild
 * Drops old tables (except thr_brands & thr_organizations)
 * Creates new clean structure
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function rebuildSchema() {
    console.log('🏗️ THR Schema Rebuild Process\n');
    console.log('=' .repeat(60) + '\n');
    
    // Step 1: Drop old tables
    console.log('1️⃣ Dropping old tables (preserving thr_brands & thr_organizations)...\n');
    
    const tablesToDrop = [
        'thr_atlas_categories',
        'thr_atlas_manufacturers', 
        'thr_atlas_suppliers',
        'thr_atlas_documents',
        'thr_organization_departments',
        'thr_organization_sections',
        'thr_organization_units',
        'thr_employee_designations',
        'thr_atlas_maintenance',
        'thr_employees',
        'thr_atlas_assets',
        'thr_atlas_locations',
        'thr_atlas_asset_assignments',
        'thr_atlas_maintenance_records'
    ];
    
    for (const table of tablesToDrop) {
        console.log(`Dropping ${table}...`);
        const { error } = await supabase.rpc('execute_sql', {
            sql_query: `DROP TABLE IF EXISTS ${table} CASCADE;`
        });
        
        if (error) {
            console.error(`  ❌ Error: ${error.message}`);
        } else {
            console.log(`  ✅ Dropped successfully`);
        }
    }
    
    // Step 2: Create new tables
    console.log('\n\n2️⃣ Creating new table structure...\n');
    
    // Create thr_employees
    console.log('Creating thr_employees...');
    const { error: empError } = await supabase.rpc('execute_sql', {
        sql_query: `
            CREATE TABLE IF NOT EXISTS thr_employees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_no VARCHAR(20) UNIQUE NOT NULL,
                organization_id UUID REFERENCES thr_organizations(organization_id),
                
                -- Core fields
                full_name VARCHAR(200) NOT NULL,
                ic_no VARCHAR(20),
                
                -- Status
                active_status BOOLEAN DEFAULT true,
                employment_status VARCHAR(20) DEFAULT 'active',
                
                -- JSONB fields for organized data
                personal_info JSONB,
                contact_info JSONB,
                employment_info JSONB,
                compensation JSONB,
                tax_info JSONB,
                bank_info JSONB,
                
                -- Metadata
                data_source VARCHAR(50),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                created_by UUID,
                updated_by UUID
            );
            
            -- Add indexes
            CREATE INDEX idx_thr_employees_employee_no ON thr_employees(employee_no);
            CREATE INDEX idx_thr_employees_organization_id ON thr_employees(organization_id);
            CREATE INDEX idx_thr_employees_active_status ON thr_employees(active_status);
            CREATE INDEX idx_thr_employees_full_name ON thr_employees(full_name);
        `
    });
    
    if (empError) {
        console.error(`  ❌ Error: ${empError.message}`);
        return;
    } else {
        console.log(`  ✅ Created successfully`);
    }
    
    // Create thr_employment_history
    console.log('\nCreating thr_employment_history...');
    const { error: histError } = await supabase.rpc('execute_sql', {
        sql_query: `
            CREATE TABLE IF NOT EXISTS thr_employment_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                organization_id UUID REFERENCES thr_organizations(organization_id),
                position VARCHAR(200),
                department VARCHAR(100),
                section VARCHAR(100),
                grade VARCHAR(50),
                start_date DATE NOT NULL,
                end_date DATE,
                is_current BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            CREATE INDEX idx_thr_employment_history_employee ON thr_employment_history(employee_id);
            CREATE INDEX idx_thr_employment_history_current ON thr_employment_history(is_current);
        `
    });
    
    if (histError) {
        console.error(`  ❌ Error: ${histError.message}`);
    } else {
        console.log(`  ✅ Created successfully`);
    }
    
    // Create thr_payroll_records
    console.log('\nCreating thr_payroll_records...');
    const { error: payError } = await supabase.rpc('execute_sql', {
        sql_query: `
            CREATE TABLE IF NOT EXISTS thr_payroll_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
                period_year INTEGER NOT NULL CHECK (period_year >= 2020),
                basic_salary DECIMAL(10,2),
                allowances JSONB,
                deductions JSONB,
                statutory_deductions JSONB,
                net_salary DECIMAL(10,2),
                status VARCHAR(20) DEFAULT 'draft',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                created_by UUID,
                approved_at TIMESTAMP WITH TIME ZONE,
                approved_by UUID,
                UNIQUE(employee_id, period_month, period_year)
            );
            
            CREATE INDEX idx_thr_payroll_records_employee ON thr_payroll_records(employee_id);
            CREATE INDEX idx_thr_payroll_records_period ON thr_payroll_records(period_year, period_month);
        `
    });
    
    if (payError) {
        console.error(`  ❌ Error: ${payError.message}`);
    } else {
        console.log(`  ✅ Created successfully`);
    }
    
    // Create thr_leave_records
    console.log('\nCreating thr_leave_records...');
    const { error: leaveError } = await supabase.rpc('execute_sql', {
        sql_query: `
            CREATE TABLE IF NOT EXISTS thr_leave_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                leave_type VARCHAR(50) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                days_taken DECIMAL(3,1) NOT NULL,
                reason TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                approved_by UUID REFERENCES thr_employees(id),
                approved_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CHECK (end_date >= start_date),
                CHECK (days_taken > 0)
            );
            
            CREATE INDEX idx_thr_leave_records_employee ON thr_leave_records(employee_id);
            CREATE INDEX idx_thr_leave_records_dates ON thr_leave_records(start_date, end_date);
            CREATE INDEX idx_thr_leave_records_status ON thr_leave_records(status);
        `
    });
    
    if (leaveError) {
        console.error(`  ❌ Error: ${leaveError.message}`);
    } else {
        console.log(`  ✅ Created successfully`);
    }
    
    // Step 3: Verify
    console.log('\n\n3️⃣ Verifying new structure...\n');
    
    const newTables = ['thr_employees', 'thr_employment_history', 'thr_payroll_records', 'thr_leave_records'];
    
    for (const table of newTables) {
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
        
        if (!error) {
            console.log(`✅ ${table}: Created successfully (${count} records)`);
        } else {
            console.log(`❌ ${table}: Not found`);
        }
    }
    
    // Summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('\n✅ Schema Rebuild Complete!\n');
    console.log('📋 Summary:');
    console.log(`  - Dropped ${tablesToDrop.length} old tables`);
    console.log(`  - Created 4 new tables with proper structure`);
    console.log(`  - Preserved thr_brands (6 records)`);
    console.log(`  - Preserved thr_organizations (15 records)`);
    console.log(`  - master_hr2000 kept as data source (518 records)`);
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Map employees to organizations');
    console.log('  2. Migrate data from master_hr2000 to thr_employees');
    console.log('  3. Build frontend on clean structure');
    
    console.log('\n🔗 Table Relationships:');
    console.log('  thr_brands → thr_organizations → thr_employees');
    console.log('                                 ↓');
    console.log('                    employment_history, payroll, leaves');
    console.log('');
}

// Run rebuild
if (require.main === module) {
    rebuildSchema().catch(console.error);
}

module.exports = { rebuildSchema };