#!/usr/bin/env node

/**
 * Check all THR-related tables and their relationships
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkTHRTables() {
    console.log('🔍 Checking THR Tables Structure\n');
    console.log('=' .repeat(60) + '\n');
    
    // Get all tables
    const { data: allTables, error } = await supabase.rpc('get_all_tables');
    
    if (error) {
        console.error('Error getting tables:', error);
        return;
    }
    
    // Filter THR tables
    const thrTables = allTables.filter(t => t.table_name?.startsWith('thr_'));
    const otherRelevantTables = ['master_hr2000', 'brands', 'organizations', 'employees'];
    
    console.log('📋 THR Tables Found:');
    thrTables.forEach(async table => {
        const { count } = await supabase
            .from(table.table_name)
            .select('*', { count: 'exact', head: true });
        console.log(`  - ${table.table_name}: ${count || 0} records`);
    });
    
    console.log('\n📋 Other Relevant Tables:');
    for (const table of otherRelevantTables) {
        const { count } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
        console.log(`  - ${table}: ${count || 0} records`);
    }
    
    // Check thr_brands and thr_organizations relationship
    console.log('\n\n🔗 Checking thr_brands → thr_organizations relationship:');
    
    // Check thr_brands structure
    const { data: brandSample } = await supabase
        .from('thr_brands')
        .select('*')
        .limit(1);
    
    if (brandSample && brandSample.length > 0) {
        console.log('\nthr_brands columns:', Object.keys(brandSample[0]));
    }
    
    // Check thr_organizations structure
    const { data: orgSample } = await supabase
        .from('thr_organizations')
        .select('*')
        .limit(1);
    
    if (orgSample && orgSample.length > 0) {
        console.log('\nthr_organizations columns:', Object.keys(orgSample[0]));
        
        // Check if brand_id exists
        if ('brand_id' in orgSample[0]) {
            console.log('\n✅ brand_id found in thr_organizations - relationship exists!');
        }
    }
    
    // List tables to drop (excluding thr_brands and thr_organizations)
    const tablesToDrop = thrTables
        .filter(t => !['thr_brands', 'thr_organizations'].includes(t.table_name))
        .map(t => t.table_name);
    
    console.log('\n\n🗑️ Tables to DROP (excluding thr_brands & thr_organizations):');
    if (tablesToDrop.length > 0) {
        tablesToDrop.forEach(table => console.log(`  - ${table}`));
        
        console.log('\n📝 SQL to drop these tables:');
        console.log('```sql');
        tablesToDrop.forEach(table => {
            console.log(`DROP TABLE IF EXISTS ${table} CASCADE;`);
        });
        console.log('```');
    } else {
        console.log('  None found');
    }
    
    // Propose new table structure
    console.log('\n\n✨ Proposed New Table Structure:');
    console.log('```sql');
    console.log(`-- 1. Employees table (main employee data)
CREATE TABLE thr_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_no VARCHAR(20) UNIQUE NOT NULL,
    organization_id UUID REFERENCES thr_organizations(id),
    
    -- Core fields
    full_name VARCHAR(200) NOT NULL,
    ic_no VARCHAR(20),
    
    -- Status
    active_status BOOLEAN DEFAULT true,
    employment_status VARCHAR(20) DEFAULT 'active', -- active, resigned, terminated
    
    -- JSONB fields for organized data
    personal_info JSONB, -- demographics, identification
    contact_info JSONB,
    employment_info JSONB, -- timeline, position, department
    compensation JSONB, -- salary, allowances, deductions
    tax_info JSONB,
    bank_info JSONB,
    
    -- Metadata
    data_source VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- 2. Employment History
CREATE TABLE thr_employment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES thr_employees(id),
    organization_id UUID REFERENCES thr_organizations(id),
    position VARCHAR(200),
    department VARCHAR(100),
    start_date DATE NOT NULL,
    end_date DATE,
    is_current BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Payroll Records
CREATE TABLE thr_payroll_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES thr_employees(id),
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    basic_salary DECIMAL(10,2),
    allowances JSONB,
    deductions JSONB,
    net_salary DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'draft', -- draft, approved, paid
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, period_month, period_year)
);

-- 4. Leave Records
CREATE TABLE thr_leave_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES thr_employees(id),
    leave_type VARCHAR(50),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_taken DECIMAL(3,1),
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    approved_by UUID REFERENCES thr_employees(id),
    created_at TIMESTAMP DEFAULT NOW()
);`);
    console.log('```');
    
    console.log('\n\n📊 Data Migration Strategy:');
    console.log('1. Keep master_hr2000 as source data (not used in frontend)');
    console.log('2. Migrate data to new thr_employees table');
    console.log('3. Establish proper relationships with thr_organizations');
    console.log('4. Create supporting tables for history, payroll, leaves, etc.');
}

// Run check
if (require.main === module) {
    checkTHRTables().catch(console.error);
}

module.exports = { checkTHRTables };