-- Simple table creation for THR system
-- Run this in Supabase SQL editor

-- Leave Types
CREATE TABLE IF NOT EXISTS thr_leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    days_per_year INTEGER DEFAULT 0,
    is_carry_forward BOOLEAN DEFAULT false,
    max_carry_forward INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leave Balances
CREATE TABLE IF NOT EXISTS thr_leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    leave_type VARCHAR(50),
    year INTEGER NOT NULL,
    entitlement DECIMAL(5,2) DEFAULT 0,
    taken DECIMAL(5,2) DEFAULT 0,
    balance DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, leave_type, year)
);

-- Claims
CREATE TABLE IF NOT EXISTS thr_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    claim_type VARCHAR(50),
    claim_no VARCHAR(50) UNIQUE,
    claim_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by UUID,
    approved_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claim Types
CREATE TABLE IF NOT EXISTS thr_claim_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    monthly_limit DECIMAL(10,2),
    yearly_limit DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Categories
CREATE TABLE IF NOT EXISTS thr_asset_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    depreciation_rate DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assets
CREATE TABLE IF NOT EXISTS thr_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_no VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID,
    brand VARCHAR(100),
    model VARCHAR(100),
    serial_no VARCHAR(100),
    purchase_date DATE,
    purchase_price DECIMAL(12,2),
    status VARCHAR(20) DEFAULT 'available',
    condition VARCHAR(20) DEFAULT 'good',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asset Assignments
CREATE TABLE IF NOT EXISTS thr_asset_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    assigned_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;