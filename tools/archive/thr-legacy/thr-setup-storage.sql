-- THR Storage Setup for Employee Photos and Documents
-- This script sets up the storage structure and related tables

-- =====================================================
-- STORAGE BUCKETS (Run in Supabase Dashboard)
-- =====================================================
-- Create these buckets in Supabase Storage:
-- 1. employee-photos (public read, authenticated write)
-- 2. employee-documents (private, authenticated only)
-- 3. company-assets (public read for logos, etc.)

-- =====================================================
-- DATABASE TABLES FOR STORAGE METADATA
-- =====================================================

-- Employee Photos Table
CREATE TABLE IF NOT EXISTS thr_employee_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES thr_employees(id) ON DELETE CASCADE,
    photo_url TEXT,
    thumbnail_url TEXT,
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    is_primary BOOLEAN DEFAULT true,
    uploaded_by UUID REFERENCES thr_employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employee Documents Table
CREATE TABLE IF NOT EXISTS thr_employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES thr_employees(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    description TEXT,
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES thr_employees(id),
    verified_date TIMESTAMPTZ,
    expiry_date DATE,
    uploaded_by UUID REFERENCES thr_employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document Types Reference Table
CREATE TABLE IF NOT EXISTS thr_document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_mandatory BOOLEAN DEFAULT false,
    has_expiry BOOLEAN DEFAULT false,
    category VARCHAR(50), -- 'personal', 'employment', 'education', 'certification'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add photo URL columns to employees table
ALTER TABLE thr_employees 
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_employee_photos_employee ON thr_employee_photos(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_photos_primary ON thr_employee_photos(employee_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON thr_employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON thr_employee_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry ON thr_employee_documents(expiry_date);

-- =====================================================
-- VIEWS
-- =====================================================

-- Employee Photos View
CREATE OR REPLACE VIEW thr_employee_photos_view AS
SELECT 
    ep.id,
    ep.employee_id,
    e.employee_no,
    e.full_name,
    ep.photo_url,
    ep.thumbnail_url,
    ep.file_name,
    ep.file_size,
    ep.is_primary,
    ep.created_at,
    uploader.full_name as uploaded_by_name
FROM thr_employee_photos ep
JOIN thr_employees e ON ep.employee_id = e.id
LEFT JOIN thr_employees uploader ON ep.uploaded_by = uploader.id;

-- Employee Documents View
CREATE OR REPLACE VIEW thr_employee_documents_view AS
SELECT 
    ed.id,
    ed.employee_id,
    e.employee_no,
    e.full_name,
    ed.document_type,
    dt.name as document_type_name,
    ed.document_name,
    ed.file_url,
    ed.file_name,
    ed.is_verified,
    ed.expiry_date,
    CASE 
        WHEN ed.expiry_date IS NOT NULL AND ed.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN ed.expiry_date IS NOT NULL AND ed.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
        ELSE 'valid'
    END as status,
    ed.created_at,
    uploader.full_name as uploaded_by_name,
    verifier.full_name as verified_by_name
FROM thr_employee_documents ed
JOIN thr_employees e ON ed.employee_id = e.id
LEFT JOIN thr_document_types dt ON ed.document_type = dt.code
LEFT JOIN thr_employees uploader ON ed.uploaded_by = uploader.id
LEFT JOIN thr_employees verifier ON ed.verified_by = verifier.id;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to generate storage path for employee photos
CREATE OR REPLACE FUNCTION get_employee_photo_path(employee_no VARCHAR, file_name VARCHAR)
RETURNS TEXT AS $$
BEGIN
    -- Format: /employee-photos/{org_code}/{employee_no}/{filename}
    -- Example: /employee-photos/TS/TS001/profile.jpg
    RETURN CONCAT(
        SUBSTRING(employee_no FROM '^[A-Z]+'), -- Extract org prefix
        '/',
        employee_no,
        '/',
        file_name
    );
END;
$$ LANGUAGE plpgsql;

-- Function to generate storage path for employee documents
CREATE OR REPLACE FUNCTION get_employee_document_path(employee_no VARCHAR, doc_type VARCHAR, file_name VARCHAR)
RETURNS TEXT AS $$
BEGIN
    -- Format: /employee-documents/{org_code}/{employee_no}/{doc_type}/{filename}
    -- Example: /employee-documents/TS/TS001/ic/ic_front.jpg
    RETURN CONCAT(
        SUBSTRING(employee_no FROM '^[A-Z]+'), -- Extract org prefix
        '/',
        employee_no,
        '/',
        LOWER(doc_type),
        '/',
        file_name
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- DEFAULT DOCUMENT TYPES
-- =====================================================
INSERT INTO thr_document_types (code, name, category, is_mandatory, has_expiry) VALUES
-- Personal Documents
('IC', 'Identity Card', 'personal', true, false),
('PASSPORT', 'Passport', 'personal', false, true),
('BIRTH_CERT', 'Birth Certificate', 'personal', false, false),
('MARRIAGE_CERT', 'Marriage Certificate', 'personal', false, false),

-- Employment Documents
('OFFER_LETTER', 'Offer Letter', 'employment', true, false),
('CONTRACT', 'Employment Contract', 'employment', true, false),
('APPOINTMENT', 'Appointment Letter', 'employment', false, false),
('CONFIRMATION', 'Confirmation Letter', 'employment', false, false),
('PROMOTION', 'Promotion Letter', 'employment', false, false),
('RESIGNATION', 'Resignation Letter', 'employment', false, false),

-- Education Documents
('DEGREE', 'Degree Certificate', 'education', false, false),
('DIPLOMA', 'Diploma Certificate', 'education', false, false),
('SPM', 'SPM Certificate', 'education', false, false),
('TRANSCRIPT', 'Academic Transcript', 'education', false, false),

-- Certifications
('DRIVING', 'Driving License', 'certification', false, true),
('PROFESSIONAL', 'Professional Certificate', 'certification', false, true),
('TRAINING', 'Training Certificate', 'certification', false, false),
('MEDICAL', 'Medical Certificate', 'certification', false, false),

-- Others
('RESUME', 'Resume/CV', 'personal', false, false),
('EPF', 'EPF Statement', 'employment', false, false),
('SOCSO', 'SOCSO Document', 'employment', false, false),
('TAX', 'Tax Document', 'employment', false, false),
('BANK', 'Bank Account Proof', 'personal', false, false)
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- STORAGE POLICIES (To be created in Supabase Dashboard)
-- =====================================================
-- For employee-photos bucket:
-- 1. Public can read all photos
-- 2. Authenticated users can upload to their own folder
-- 3. HR admins can upload to any folder

-- For employee-documents bucket:
-- 1. Employees can read their own documents
-- 2. Employees can upload their own documents
-- 3. HR admins can read/write all documents
-- 4. Managers can read their team's documents

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update employee photo_url when primary photo changes
CREATE OR REPLACE FUNCTION update_employee_photo_url()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_primary = true THEN
        -- Update employee table with new primary photo
        UPDATE thr_employees 
        SET 
            photo_url = NEW.photo_url,
            thumbnail_url = NEW.thumbnail_url,
            updated_at = NOW()
        WHERE id = NEW.employee_id;
        
        -- Set other photos as non-primary
        UPDATE thr_employee_photos 
        SET is_primary = false 
        WHERE employee_id = NEW.employee_id 
        AND id != NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_employee_photo_url_trigger
AFTER INSERT OR UPDATE ON thr_employee_photos
FOR EACH ROW
EXECUTE FUNCTION update_employee_photo_url();