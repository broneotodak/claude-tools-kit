
-- Create basic error logs table
CREATE TABLE IF NOT EXISTS ctk_error_logs (
    id BIGSERIAL PRIMARY KEY,
    error_type VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    project_name VARCHAR(100) NOT NULL,
    page_url TEXT,
    environment VARCHAR(50) DEFAULT 'production',
    user_id TEXT,
    metadata JSONB DEFAULT '{}',
    severity VARCHAR(20) DEFAULT 'error',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    memory_id BIGINT
);

-- Create basic indexes
CREATE INDEX idx_ctk_error_logs_project ON ctk_error_logs(project_name);
CREATE INDEX idx_ctk_error_logs_created_at ON ctk_error_logs(created_at DESC);
      