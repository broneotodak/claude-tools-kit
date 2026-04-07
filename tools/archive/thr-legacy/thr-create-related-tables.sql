-- THR Related Tables Schema
-- This script creates all the related tables for leave management, claims, and assets

-- =====================================================
-- LEAVE MANAGEMENT TABLES
-- =====================================================

-- Leave Types Reference Table
CREATE TABLE IF NOT EXISTS thr_leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    days_per_year INTEGER DEFAULT 0,
    is_carry_forward BOOLEAN DEFAULT false,
    max_carry_forward INTEGER DEFAULT 0,
    is_encashable BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leave Balances (Current balance for each employee)
CREATE TABLE IF NOT EXISTS thr_leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES thr_employees(id) ON DELETE CASCADE,
    leave_type_id UUID REFERENCES thr_leave_types(id),
    leave_type VARCHAR(50), -- For backward compatibility
    year INTEGER NOT NULL,
    entitlement DECIMAL(5,2) DEFAULT 0,
    carry_forward DECIMAL(5,2) DEFAULT 0,
    taken DECIMAL(5,2) DEFAULT 0,
    pending DECIMAL(5,2) DEFAULT 0,
    balance DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, leave_type, year)
);

-- Leave Requests/Applications
CREATE TABLE IF NOT EXISTS thr_leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES thr_employees(id),
    leave_type_id UUID REFERENCES thr_leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days DECIMAL(5,2) NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by UUID REFERENCES thr_employees(id),
    approved_date TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CLAIMS MANAGEMENT TABLES
-- =====================================================

-- Claim Types Reference Table
CREATE TABLE IF NOT EXISTS thr_claim_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    monthly_limit DECIMAL(10,2),
    yearly_limit DECIMAL(10,2),
    requires_receipt BOOLEAN DEFAULT true,
    auto_approve_limit DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claims/Reimbursements
CREATE TABLE IF NOT EXISTS thr_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES thr_employees(id),
    claim_type_id UUID REFERENCES thr_claim_types(id),
    claim_type VARCHAR(50), -- For backward compatibility
    claim_no VARCHAR(50) UNIQUE,
    claim_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    receipt_urls JSONB, -- Array of receipt URLs
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    approved_by UUID REFERENCES thr_employees(id),
    approved_date TIMESTAMPTZ,
    approved_amount DECIMAL(10,2),
    rejection_reason TEXT,
    payment_date DATE,
    payment_reference VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claim Items (for detailed claims)
CREATE TABLE IF NOT EXISTS thr_claim_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL REFERENCES thr_claims(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    receipt_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ASSET MANAGEMENT TABLES
-- =====================================================

-- Asset Categories
CREATE TABLE IF NOT EXISTS thr_asset_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    parent_id UUID REFERENCES thr_asset_categories(id),
    depreciation_rate DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assets Master Table
CREATE TABLE IF NOT EXISTS thr_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_no VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES thr_asset_categories(id),
    brand VARCHAR(100),
    model VARCHAR(100),
    serial_no VARCHAR(100),
    purchase_date DATE,
    purchase_price DECIMAL(12,2),
    current_value DECIMAL(12,2),
    location VARCHAR(255),
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'maintenance', 'disposed', 'lost')),
    condition VARCHAR(20) DEFAULT 'good' CHECK (condition IN ('excellent', 'good', 'fair', 'poor')),
    warranty_expiry DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Assignments
CREATE TABLE IF NOT EXISTS thr_asset_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES thr_assets(id),
    employee_id UUID NOT NULL REFERENCES thr_employees(id),
    assigned_date DATE NOT NULL,
    return_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'returned', 'transferred')),
    condition_on_assign VARCHAR(20),
    condition_on_return VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(asset_id, employee_id, assigned_date)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Leave indexes
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON thr_leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_year ON thr_leave_balances(year);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON thr_leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON thr_leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON thr_leave_requests(status);

-- Claims indexes
CREATE INDEX IF NOT EXISTS idx_claims_employee ON thr_claims(employee_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON thr_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_date ON thr_claims(claim_date);
CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON thr_claim_items(claim_id);

-- Assets indexes
CREATE INDEX IF NOT EXISTS idx_assets_status ON thr_assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_category ON thr_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset ON thr_asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_employee ON thr_asset_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_status ON thr_asset_assignments(status);

-- =====================================================
-- VIEWS FOR EASIER QUERYING
-- =====================================================

-- Current Asset Assignments View
CREATE OR REPLACE VIEW thr_employee_assets_view AS
SELECT 
    aa.id as assignment_id,
    aa.employee_id,
    aa.asset_id,
    aa.assigned_date,
    aa.status as assignment_status,
    a.asset_no,
    a.name as asset_name,
    a.description,
    a.brand,
    a.model,
    a.serial_no,
    a.status as asset_status,
    a.condition,
    ac.name as category_name,
    e.employee_no,
    e.full_name as employee_name
FROM thr_asset_assignments aa
JOIN thr_assets a ON aa.asset_id = a.id
LEFT JOIN thr_asset_categories ac ON a.category_id = ac.id
JOIN thr_employees e ON aa.employee_id = e.id
WHERE aa.status = 'active';

-- Employee Leave Summary View
CREATE OR REPLACE VIEW thr_employee_leave_summary AS
SELECT 
    e.id as employee_id,
    e.employee_no,
    e.full_name,
    lb.year,
    lb.leave_type,
    lt.name as leave_type_name,
    lb.entitlement,
    lb.taken,
    lb.pending,
    lb.balance
FROM thr_employees e
LEFT JOIN thr_leave_balances lb ON e.id = lb.employee_id
LEFT JOIN thr_leave_types lt ON lb.leave_type = lt.code
WHERE e.employment_status = 'active';

-- =====================================================
-- SAMPLE DATA FOR REFERENCE TABLES
-- =====================================================

-- Insert default leave types
INSERT INTO thr_leave_types (code, name, days_per_year, is_carry_forward, max_carry_forward) VALUES
('AL', 'Annual Leave', 14, true, 7),
('ML', 'Medical Leave', 14, false, 0),
('EL', 'Emergency Leave', 3, false, 0),
('UPL', 'Unpaid Leave', 0, false, 0),
('MAT', 'Maternity Leave', 60, false, 0),
('PAT', 'Paternity Leave', 7, false, 0)
ON CONFLICT (code) DO NOTHING;

-- Insert default claim types
INSERT INTO thr_claim_types (code, name, monthly_limit, yearly_limit, requires_receipt) VALUES
('MED', 'Medical', 500.00, 6000.00, true),
('TRV', 'Travel', 1000.00, 12000.00, true),
('MOB', 'Mobile Phone', 150.00, 1800.00, true),
('ENT', 'Entertainment', 500.00, 6000.00, true),
('TRN', 'Training', NULL, 5000.00, true),
('MISC', 'Miscellaneous', 200.00, 2400.00, true)
ON CONFLICT (code) DO NOTHING;

-- Insert default asset categories
INSERT INTO thr_asset_categories (code, name, depreciation_rate) VALUES
('IT', 'IT Equipment', 33.33),
('MOB', 'Mobile Devices', 50.00),
('FUR', 'Furniture', 10.00),
('VEH', 'Vehicles', 20.00),
('OFF', 'Office Equipment', 20.00)
ON CONFLICT (code) DO NOTHING;