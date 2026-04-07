-- Create activity_log table for FlowState memory sync
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    user_id TEXT DEFAULT 'neo_todak',
    machine_id INTEGER,
    machine_name TEXT,
    tool TEXT,
    activity_type TEXT NOT NULL,
    project_name TEXT,
    description TEXT,
    metadata JSONB,
    source_memory_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_name);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_machine ON activity_log(machine_name);
CREATE INDEX IF NOT EXISTS idx_activity_log_source ON activity_log(source_memory_id);

-- Add RLS policy
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Create policy for neo_todak
DROP POLICY IF EXISTS "neo_todak_policy" ON activity_log;
CREATE POLICY "neo_todak_policy" ON activity_log
    FOR ALL USING (user_id = 'neo_todak');

-- Grant permissions
GRANT ALL ON activity_log TO authenticated;
GRANT ALL ON activity_log TO service_role;

-- Test the table
INSERT INTO activity_log (
    activity_type,
    project_name,
    machine_name,
    tool,
    description,
    metadata
) VALUES (
    'table_created',
    'FlowState',
    'MacBook Pro',
    'SQL Editor',
    'activity_log table created successfully',
    '{"test": true, "created_by": "create-activity-log.sql"}'::jsonb
);