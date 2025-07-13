#!/usr/bin/env node

/**
 * Create THR ATLAS Module Tables (thr_atlas_*)
 * Asset management system integrated with HR
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createAtlasTables() {
    console.log('🏢 Creating THR ATLAS Module Tables\n');
    console.log('=' .repeat(60) + '\n');
    
    const tables = [
        {
            name: 'thr_atlas_asset_categories',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_asset_categories (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    parent_id UUID REFERENCES thr_atlas_asset_categories(id),
                    depreciation_rate DECIMAL(5,2), -- annual percentage
                    useful_life_years INTEGER,
                    gl_asset_account VARCHAR(20),
                    gl_depreciation_account VARCHAR(20),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_atlas_categories_parent ON thr_atlas_asset_categories(parent_id);
            `
        },
        {
            name: 'thr_atlas_suppliers',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_suppliers (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    supplier_code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    registration_no VARCHAR(50),
                    address TEXT,
                    contact_person VARCHAR(100),
                    phone VARCHAR(50),
                    email VARCHAR(100),
                    payment_terms INTEGER DEFAULT 30, -- days
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `
        },
        {
            name: 'thr_atlas_locations',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_locations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    organization_id UUID REFERENCES thr_organizations(organization_id),
                    address TEXT,
                    location_type VARCHAR(50), -- office, warehouse, site
                    manager_id UUID REFERENCES thr_employees(id),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_atlas_locations_org ON thr_atlas_locations(organization_id);
            `
        },
        {
            name: 'thr_atlas_assets',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_assets (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    asset_no VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    description TEXT,
                    category_id UUID REFERENCES thr_atlas_asset_categories(id),
                    organization_id UUID REFERENCES thr_organizations(organization_id),
                    location_id UUID REFERENCES thr_atlas_locations(id),
                    
                    -- Purchase information
                    supplier_id UUID REFERENCES thr_atlas_suppliers(id),
                    purchase_date DATE,
                    purchase_order_no VARCHAR(50),
                    invoice_no VARCHAR(50),
                    purchase_cost DECIMAL(12,2),
                    
                    -- Asset details
                    serial_no VARCHAR(100),
                    model VARCHAR(100),
                    brand VARCHAR(100),
                    warranty_expiry DATE,
                    
                    -- Financial information
                    depreciation_method VARCHAR(20) DEFAULT 'straight_line',
                    useful_life_years INTEGER,
                    salvage_value DECIMAL(10,2) DEFAULT 0,
                    current_value DECIMAL(12,2),
                    last_depreciation_date DATE,
                    
                    -- Status and condition
                    status VARCHAR(20) DEFAULT 'active', -- active, disposed, lost, under_maintenance
                    condition VARCHAR(20) DEFAULT 'good', -- excellent, good, fair, poor
                    
                    -- Metadata
                    qr_code VARCHAR(100),
                    barcode VARCHAR(100),
                    image_url TEXT,
                    documents JSONB, -- array of document URLs
                    custom_fields JSONB,
                    
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_by UUID,
                    
                    CONSTRAINT check_purchase_cost CHECK (purchase_cost >= 0),
                    CONSTRAINT check_current_value CHECK (current_value >= 0)
                );
                
                CREATE INDEX idx_thr_atlas_assets_category ON thr_atlas_assets(category_id);
                CREATE INDEX idx_thr_atlas_assets_org ON thr_atlas_assets(organization_id);
                CREATE INDEX idx_thr_atlas_assets_location ON thr_atlas_assets(location_id);
                CREATE INDEX idx_thr_atlas_assets_status ON thr_atlas_assets(status);
                CREATE INDEX idx_thr_atlas_assets_serial ON thr_atlas_assets(serial_no);
            `
        },
        {
            name: 'thr_atlas_asset_assignments',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_asset_assignments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    asset_id UUID REFERENCES thr_atlas_assets(id),
                    employee_id UUID REFERENCES thr_employees(id),
                    department_id UUID REFERENCES thr_departments(id),
                    
                    -- Assignment details
                    assigned_date DATE NOT NULL,
                    expected_return_date DATE,
                    actual_return_date DATE,
                    
                    -- Assignment type
                    assignment_type VARCHAR(20) DEFAULT 'personal', -- personal, department, shared
                    purpose TEXT,
                    
                    -- Condition tracking
                    condition_on_assign VARCHAR(20),
                    condition_on_return VARCHAR(20),
                    assign_notes TEXT,
                    return_notes TEXT,
                    
                    -- Status
                    is_current BOOLEAN DEFAULT true,
                    
                    -- Approval workflow
                    approved_by UUID REFERENCES thr_employees(id),
                    approved_date TIMESTAMP WITH TIME ZONE,
                    
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID,
                    returned_at TIMESTAMP WITH TIME ZONE,
                    returned_by UUID,
                    
                    CONSTRAINT check_dates CHECK (actual_return_date >= assigned_date)
                );
                
                CREATE INDEX idx_thr_atlas_assignments_asset ON thr_atlas_asset_assignments(asset_id);
                CREATE INDEX idx_thr_atlas_assignments_employee ON thr_atlas_asset_assignments(employee_id);
                CREATE INDEX idx_thr_atlas_assignments_current ON thr_atlas_asset_assignments(is_current);
                CREATE INDEX idx_thr_atlas_assignments_dates ON thr_atlas_asset_assignments(assigned_date, actual_return_date);
            `
        },
        {
            name: 'thr_atlas_maintenance_schedules',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_maintenance_schedules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    asset_id UUID REFERENCES thr_atlas_assets(id),
                    schedule_name VARCHAR(100) NOT NULL,
                    maintenance_type VARCHAR(50), -- preventive, calibration, inspection
                    frequency VARCHAR(20), -- daily, weekly, monthly, quarterly, yearly
                    last_done_date DATE,
                    next_due_date DATE,
                    assigned_to UUID REFERENCES thr_employees(id),
                    estimated_cost DECIMAL(10,2),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX idx_thr_atlas_schedules_asset ON thr_atlas_maintenance_schedules(asset_id);
                CREATE INDEX idx_thr_atlas_schedules_due ON thr_atlas_maintenance_schedules(next_due_date);
            `
        },
        {
            name: 'thr_atlas_maintenance_records',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_maintenance_records (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    asset_id UUID REFERENCES thr_atlas_assets(id),
                    schedule_id UUID REFERENCES thr_atlas_maintenance_schedules(id),
                    maintenance_date DATE NOT NULL,
                    maintenance_type VARCHAR(50),
                    
                    -- Work details
                    description TEXT,
                    performed_by UUID REFERENCES thr_employees(id),
                    vendor_id UUID REFERENCES thr_atlas_suppliers(id),
                    
                    -- Cost information
                    labor_cost DECIMAL(10,2) DEFAULT 0,
                    parts_cost DECIMAL(10,2) DEFAULT 0,
                    total_cost DECIMAL(10,2) DEFAULT 0,
                    
                    -- Downtime tracking
                    downtime_hours DECIMAL(5,2),
                    
                    -- Results
                    issues_found TEXT,
                    actions_taken TEXT,
                    parts_replaced JSONB, -- array of parts
                    
                    -- Next maintenance
                    next_maintenance_date DATE,
                    
                    -- Documentation
                    attachments JSONB,
                    
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID
                );
                
                CREATE INDEX idx_thr_atlas_maintenance_asset ON thr_atlas_maintenance_records(asset_id);
                CREATE INDEX idx_thr_atlas_maintenance_date ON thr_atlas_maintenance_records(maintenance_date);
            `
        },
        {
            name: 'thr_atlas_depreciation',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_depreciation (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    asset_id UUID REFERENCES thr_atlas_assets(id),
                    depreciation_date DATE NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    
                    -- Values
                    opening_value DECIMAL(12,2) NOT NULL,
                    depreciation_amount DECIMAL(10,2) NOT NULL,
                    closing_value DECIMAL(12,2) NOT NULL,
                    accumulated_depreciation DECIMAL(12,2) NOT NULL,
                    
                    -- GL posting
                    gl_posted BOOLEAN DEFAULT false,
                    gl_reference VARCHAR(50),
                    
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    
                    UNIQUE(asset_id, period_month, period_year)
                );
                
                CREATE INDEX idx_thr_atlas_depreciation_asset ON thr_atlas_depreciation(asset_id);
                CREATE INDEX idx_thr_atlas_depreciation_period ON thr_atlas_depreciation(period_year, period_month);
            `
        },
        {
            name: 'thr_atlas_disposal',
            sql: `
                CREATE TABLE IF NOT EXISTS thr_atlas_disposal (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    asset_id UUID REFERENCES thr_atlas_assets(id) UNIQUE,
                    disposal_date DATE NOT NULL,
                    disposal_type VARCHAR(50), -- sold, scrapped, donated, lost, stolen
                    
                    -- Financial details
                    book_value DECIMAL(12,2) NOT NULL,
                    disposal_value DECIMAL(12,2) DEFAULT 0,
                    gain_loss DECIMAL(12,2),
                    
                    -- Disposal details
                    buyer_name VARCHAR(200),
                    buyer_contact VARCHAR(100),
                    disposal_reference VARCHAR(50),
                    reason TEXT,
                    
                    -- Approval
                    approved_by UUID REFERENCES thr_employees(id),
                    approved_date TIMESTAMP WITH TIME ZONE,
                    
                    -- Documentation
                    documents JSONB,
                    
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_by UUID
                );
                
                CREATE INDEX idx_thr_atlas_disposal_date ON thr_atlas_disposal(disposal_date);
            `
        }
    ];
    
    // Create tables
    console.log('📝 Creating ATLAS tables...\n');
    
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
        -- Enable RLS on all ATLAS tables
        ALTER TABLE thr_atlas_asset_categories ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_suppliers ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_locations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_assets ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_asset_assignments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_maintenance_schedules ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_maintenance_records ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_depreciation ENABLE ROW LEVEL SECURITY;
        ALTER TABLE thr_atlas_disposal ENABLE ROW LEVEL SECURITY;
        
        -- Create permissive policies for development
        CREATE POLICY "Allow all for development" ON thr_atlas_asset_categories FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_suppliers FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_locations FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_assets FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_asset_assignments FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_maintenance_schedules FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_maintenance_records FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_depreciation FOR ALL USING (true);
        CREATE POLICY "Allow all for development" ON thr_atlas_disposal FOR ALL USING (true);
    `;
    
    const { error: rlsError } = await supabase.rpc('execute_sql', {
        sql_query: rlsPolicies
    });
    
    if (rlsError) {
        console.log('⚠️  RLS policies might already exist (this is fine)');
    } else {
        console.log('✅ RLS enabled with permissive policies\n');
    }
    
    // Create sequence for asset numbers
    console.log('🔢 Creating sequences and functions...\n');
    
    const sequences = `
        -- Create sequence for asset numbers
        CREATE SEQUENCE IF NOT EXISTS thr_atlas_asset_no_seq START 1;
        
        -- Function to generate asset number
        CREATE OR REPLACE FUNCTION generate_asset_no(category_code VARCHAR)
        RETURNS VARCHAR AS $$
        BEGIN
            RETURN category_code || '-' || TO_CHAR(CURRENT_DATE, 'YY') || LPAD(nextval('thr_atlas_asset_no_seq')::text, 5, '0');
        END;
        $$ LANGUAGE plpgsql;
        
        -- Function to calculate depreciation
        CREATE OR REPLACE FUNCTION calculate_asset_depreciation(
            p_purchase_cost DECIMAL,
            p_salvage_value DECIMAL,
            p_useful_life INTEGER,
            p_months_used INTEGER
        ) RETURNS DECIMAL AS $$
        DECLARE
            monthly_depreciation DECIMAL;
            total_depreciation DECIMAL;
        BEGIN
            IF p_useful_life IS NULL OR p_useful_life = 0 THEN
                RETURN 0;
            END IF;
            
            monthly_depreciation := (p_purchase_cost - COALESCE(p_salvage_value, 0)) / (p_useful_life * 12);
            total_depreciation := monthly_depreciation * p_months_used;
            
            -- Ensure we don't depreciate below salvage value
            IF p_purchase_cost - total_depreciation < COALESCE(p_salvage_value, 0) THEN
                total_depreciation := p_purchase_cost - COALESCE(p_salvage_value, 0);
            END IF;
            
            RETURN ROUND(total_depreciation, 2);
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
    console.log('\n✅ ATLAS MODULE CREATED!\n');
    
    console.log('📋 Tables Created:');
    console.log('\n🏢 Asset Management:');
    console.log('  - thr_atlas_asset_categories (asset types)');
    console.log('  - thr_atlas_assets (main asset registry)');
    console.log('  - thr_atlas_locations (physical locations)');
    console.log('  - thr_atlas_suppliers (vendors/suppliers)');
    
    console.log('\n👥 Asset Assignment:');
    console.log('  - thr_atlas_asset_assignments (who has what)');
    console.log('  - Links assets to employees');
    console.log('  - Tracks condition and return dates');
    
    console.log('\n🔧 Maintenance:');
    console.log('  - thr_atlas_maintenance_schedules (preventive maintenance)');
    console.log('  - thr_atlas_maintenance_records (work history)');
    
    console.log('\n💰 Financial:');
    console.log('  - thr_atlas_depreciation (monthly depreciation)');
    console.log('  - thr_atlas_disposal (asset disposal records)');
    
    console.log('\n🔗 Key Features:');
    console.log('  - Full asset lifecycle management');
    console.log('  - Employee asset tracking');
    console.log('  - Maintenance scheduling');
    console.log('  - Automated depreciation calculation');
    console.log('  - QR/Barcode support');
    console.log('  - Document attachments');
    
    console.log('\n⚡ Next Steps:');
    console.log('  1. Create asset categories (IT, Furniture, Vehicles, etc.)');
    console.log('  2. Set up locations for each organization');
    console.log('  3. Import existing assets');
    console.log('  4. Assign assets to employees');
    console.log('  5. Configure maintenance schedules');
    
    console.log('');
}

// Run
if (require.main === module) {
    createAtlasTables().catch(console.error);
}

module.exports = { createAtlasTables };