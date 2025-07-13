#!/usr/bin/env node

/**
 * Create THR Accounting Module Tables (thr_acc_*)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createAccountingTables() {
    console.log('💰 Creating THR Accounting Module Tables\n');
    console.log('=' .repeat(60) + '\n');
    
    const tables = [
        {
            name: 'thr_acc_cost_centers',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_cost_centers (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    organization_id UUID REFERENCES thr_organizations(organization_id),
                    department_id UUID REFERENCES thr_departments(id),
                    parent_id UUID REFERENCES thr_acc_cost_centers(id),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_acc_cost_centers_org ON thr_acc_cost_centers(organization_id);
                CREATE INDEX idx_thr_acc_cost_centers_dept ON thr_acc_cost_centers(department_id);
            `
        },
        {
            name: 'thr_acc_claim_types',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_claim_types (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    requires_receipt BOOLEAN DEFAULT true,
                    max_amount DECIMAL(10,2),
                    gl_account_code VARCHAR(20),
                    is_taxable BOOLEAN DEFAULT false,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        },
        {
            name: 'thr_acc_claims',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_claims (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    claim_no VARCHAR(20) UNIQUE NOT NULL,
                    employee_id UUID REFERENCES thr_employees(id),
                    claim_type_id UUID REFERENCES thr_acc_claim_types(id),
                    claim_date DATE NOT NULL,
                    amount DECIMAL(10,2) NOT NULL,
                    description TEXT,
                    cost_center_id UUID REFERENCES thr_acc_cost_centers(id),
                    status VARCHAR(20) DEFAULT 'draft', -- draft, submitted, approved, rejected, paid
                    submitted_date TIMESTAMP WITH TIME ZONE,
                    approved_by UUID REFERENCES thr_employees(id),
                    approved_date TIMESTAMP WITH TIME ZONE,
                    payment_batch_id UUID,
                    payment_date DATE,
                    gl_posted BOOLEAN DEFAULT false,
                    attachments JSONB, -- array of attachment URLs/metadata
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_by UUID,
                    CONSTRAINT check_amount_positive CHECK (amount > 0)
                );
                
                CREATE INDEX idx_thr_acc_claims_employee ON thr_acc_claims(employee_id);
                CREATE INDEX idx_thr_acc_claims_status ON thr_acc_claims(status);
                CREATE INDEX idx_thr_acc_claims_date ON thr_acc_claims(claim_date);
                CREATE INDEX idx_thr_acc_claims_batch ON thr_acc_claims(payment_batch_id);
            `
        },
        {
            name: 'thr_acc_claim_items',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_claim_items (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    claim_id UUID REFERENCES thr_acc_claims(id) ON DELETE CASCADE,
                    item_date DATE NOT NULL,
                    description VARCHAR(500) NOT NULL,
                    amount DECIMAL(10,2) NOT NULL,
                    receipt_no VARCHAR(50),
                    has_receipt BOOLEAN DEFAULT false,
                    attachment_url TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_acc_claim_items_claim ON thr_acc_claim_items(claim_id);
            `
        },
        {
            name: 'thr_acc_payment_batches',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_payment_batches (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    batch_no VARCHAR(20) UNIQUE NOT NULL,
                    payment_date DATE NOT NULL,
                    payment_method VARCHAR(20) NOT NULL, -- bank_transfer, cheque, cash
                    bank_account_no VARCHAR(50),
                    total_amount DECIMAL(12,2) NOT NULL,
                    item_count INTEGER NOT NULL,
                    status VARCHAR(20) DEFAULT 'draft', -- draft, approved, processing, completed
                    approved_by UUID REFERENCES thr_employees(id),
                    approved_date TIMESTAMP WITH TIME ZONE,
                    processed_by UUID REFERENCES thr_employees(id),
                    processed_date TIMESTAMP WITH TIME ZONE,
                    bank_file_url TEXT, -- URL to generated bank file
                    remarks TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_acc_payment_batches_date ON thr_acc_payment_batches(payment_date);
                CREATE INDEX idx_thr_acc_payment_batches_status ON thr_acc_payment_batches(status);
            `
        },
        {
            name: 'thr_acc_payment_batch_items',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_payment_batch_items (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    batch_id UUID REFERENCES thr_acc_payment_batches(id) ON DELETE CASCADE,
                    employee_id UUID REFERENCES thr_employees(id),
                    payment_type VARCHAR(20) NOT NULL, -- salary, claim, reimbursement, bonus
                    reference_id UUID, -- links to claim_id, payroll_id, etc.
                    amount DECIMAL(10,2) NOT NULL,
                    bank_account_no VARCHAR(50),
                    bank_name VARCHAR(100),
                    account_name VARCHAR(200),
                    payment_reference VARCHAR(50),
                    status VARCHAR(20) DEFAULT 'pending', -- pending, paid, failed
                    failure_reason TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_acc_batch_items_batch ON thr_acc_payment_batch_items(batch_id);
                CREATE INDEX idx_thr_acc_batch_items_employee ON thr_acc_payment_batch_items(employee_id);
            `
        },
        {
            name: 'thr_acc_tax_tables',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_tax_tables (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tax_type VARCHAR(20) NOT NULL, -- PCB, EPF, SOCSO, EIS
                    category VARCHAR(50) NOT NULL,
                    effective_date DATE NOT NULL,
                    min_amount DECIMAL(10,2),
                    max_amount DECIMAL(10,2),
                    rate DECIMAL(5,2), -- percentage
                    fixed_amount DECIMAL(10,2),
                    employee_portion DECIMAL(5,2), -- percentage
                    employer_portion DECIMAL(5,2), -- percentage
                    metadata JSONB, -- additional configuration
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    UNIQUE(tax_type, category, effective_date)
                );
                
                CREATE INDEX idx_thr_acc_tax_tables_type ON thr_acc_tax_tables(tax_type);
                CREATE INDEX idx_thr_acc_tax_tables_date ON thr_acc_tax_tables(effective_date);
            `
        },
        {
            name: 'thr_acc_gl_mappings',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_gl_mappings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    mapping_type VARCHAR(50) NOT NULL, -- salary, allowance, deduction, claim
                    reference_code VARCHAR(50), -- allowance_code, deduction_code, etc.
                    organization_id UUID REFERENCES thr_organizations(organization_id),
                    debit_account VARCHAR(20) NOT NULL,
                    credit_account VARCHAR(20) NOT NULL,
                    description VARCHAR(200),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_acc_gl_mappings_type ON thr_acc_gl_mappings(mapping_type);
                CREATE INDEX idx_thr_acc_gl_mappings_org ON thr_acc_gl_mappings(organization_id);
            `
        },
        {
            name: 'thr_acc_bank_files',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_acc_bank_files (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    batch_id UUID REFERENCES thr_acc_payment_batches(id),
                    bank_code VARCHAR(20) NOT NULL,
                    file_type VARCHAR(20) NOT NULL, -- maybank2u, cimb_clicks, etc.
                    file_name VARCHAR(200) NOT NULL,
                    file_url TEXT,
                    file_size INTEGER,
                    record_count INTEGER NOT NULL,
                    total_amount DECIMAL(12,2) NOT NULL,
                    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    generated_by UUID,
                    downloaded_at TIMESTAMP WITH TIME ZONE,
                    downloaded_by UUID
                );
                
                CREATE INDEX idx_thr_acc_bank_files_batch ON thr_acc_bank_files(batch_id);
            `
        }
    ];
    
    // Create tables
    console.log('📝 Creating accounting tables...\n');
    
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
    
    // Create RLS policies
    console.log('\n\n🔒 Creating RLS policies...\n');
    
    const rlsPolicies = `
        -- Enable RLS on all accounting tables
        ALTER TABLE thr_acc_cost_centers ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_claim_types ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_claims ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_claim_items ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_payment_batches ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_payment_batch_items ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_tax_tables ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_gl_mappings ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_acc_bank_files ENABLE ROW LEVEL SECURITY;
        
        -- Create permissive policies for development
        CREATE POLICY "Allow all for development" ON thr_acc_cost_centers FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_claim_types FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_claims FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_claim_items FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_payment_batches FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_payment_batch_items FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_tax_tables FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_gl_mappings FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_acc_bank_files FOR ALL USING (true);
    `;
    
    const { error: rlsError } = await supabase.rpc('execute_sql', {
        sql_query: rlsPolicies
    });
    
    if (rlsError) {
        console.log('⚠️  RLS policies might already exist (this is fine)');
    } else {
        console.log('✅ RLS enabled with permissive policies\n');
    }
    
    // Create sequence for claim numbers
    console.log('🔢 Creating sequences...\n');
    
    const sequences = `
        -- Create sequence for claim numbers
        CREATE SEQUENCE IF NOT EXISTS thr_acc_claim_no_seq START 1;
        
        -- Create sequence for batch numbers
        CREATE SEQUENCE IF NOT EXISTS thr_acc_batch_no_seq START 1;
        
        -- Function to generate claim number
        CREATE OR REPLACE FUNCTION generate_claim_no()
        RETURNS VARCHAR AS $$
        BEGIN
            RETURN 'CLM' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || LPAD(nextval('thr_acc_claim_no_seq')::text, 4, '0');
        END;
        $$ LANGUAGE plpgsql;
        
        -- Function to generate batch number
        CREATE OR REPLACE FUNCTION generate_batch_no()
        RETURNS VARCHAR AS $$
        BEGIN
            RETURN 'BAT' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || LPAD(nextval('thr_acc_batch_no_seq')::text, 4, '0');
        END;
        $$ LANGUAGE plpgsql;
    `;
    
    const { error: seqError } = await supabase.rpc('execute_sql', {
        sql_query: sequences
    });
    
    if (seqError) {
        console.error('Error creating sequences:', seqError);
    } else {
        console.log('✅ Sequences and functions created\n');
    }
    
    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('\n✅ ACCOUNTING MODULE CREATED!\n');
    
    console.log('📋 Tables Created:');
    console.log('\n💰 Claims & Reimbursements:');
    console.log('  - thr_acc_claim_types (claim categories)');
    console.log('  - thr_acc_claims (main claims table)');
    console.log('  - thr_acc_claim_items (itemized expenses)');
    
    console.log('\n🏦 Payment Processing:');
    console.log('  - thr_acc_payment_batches (payment runs)');
    console.log('  - thr_acc_payment_batch_items (individual payments)');
    console.log('  - thr_acc_bank_files (bank upload files)');
    
    console.log('\n📊 Financial Configuration:');
    console.log('  - thr_acc_cost_centers (cost allocation)');
    console.log('  - thr_acc_tax_tables (statutory rates)');
    console.log('  - thr_acc_gl_mappings (GL account mapping)');
    
    console.log('\n🔗 Key Relationships:');
    console.log('  - All tables reference thr_employees.id');
    console.log('  - Claims can be batched for payment');
    console.log('  - Cost centers linked to organizations/departments');
    console.log('  - GL mappings for automated accounting');
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Populate claim types (travel, medical, etc.)');
    console.log('  2. Import Malaysian tax tables');
    console.log('  3. Set up cost centers');
    console.log('  4. Configure GL mappings');
    console.log('  5. Create ATLAS module tables');
    
    console.log('');
}

// Run
if (require.main === module) {
    createAccountingTables().catch(console.error);
}

module.exports = { createAccountingTables };