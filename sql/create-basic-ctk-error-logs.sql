-- Basic CTK Error Logs Table
-- Run this in Supabase SQL Editor to enable unified error tracking

-- Create the table
CREATE TABLE IF NOT EXISTS ctk_error_logs (
    id BIGSERIAL PRIMARY KEY,
    error_type VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    error_code VARCHAR(50),
    project_name VARCHAR(100) NOT NULL,
    page_url TEXT,
    environment VARCHAR(50) DEFAULT 'production',
    user_id TEXT,
    user_agent TEXT,
    session_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    severity VARCHAR(20) DEFAULT 'error',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    memory_id BIGINT,
    notes TEXT,
    resolution TEXT
);

-- Create essential indexes
CREATE INDEX idx_ctk_error_logs_created_at ON ctk_error_logs(created_at DESC);
CREATE INDEX idx_ctk_error_logs_project ON ctk_error_logs(project_name);
CREATE INDEX idx_ctk_error_logs_severity ON ctk_error_logs(severity);
CREATE INDEX idx_ctk_error_logs_resolved ON ctk_error_logs(resolved);

-- Enable RLS
ALTER TABLE ctk_error_logs ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert errors (for client-side error reporting)
CREATE POLICY "Anyone can insert errors" ON ctk_error_logs
    FOR INSERT 
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to read errors
CREATE POLICY "Authenticated can read errors" ON ctk_error_logs
    FOR SELECT
    TO authenticated
    USING (true);

-- Quick check
SELECT 'CTK Error Logs table created successfully!' as status,
       COUNT(*) as total_errors
FROM ctk_error_logs;