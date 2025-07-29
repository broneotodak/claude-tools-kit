-- Create unified error logs table in CTK memory database
-- This table will track errors from all projects and link with memory system

-- Create error logs table
CREATE TABLE IF NOT EXISTS ctk_error_logs (
    id BIGSERIAL PRIMARY KEY,
    
    -- Error details
    error_type VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    error_code VARCHAR(50),
    
    -- Project context
    project_name VARCHAR(100) NOT NULL,
    page_url TEXT,
    environment VARCHAR(50) DEFAULT 'production',
    
    -- User context
    user_id UUID REFERENCES auth.users(id),
    user_agent TEXT,
    session_id VARCHAR(100),
    ip_address INET,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    severity VARCHAR(20) DEFAULT 'error', -- debug, info, warning, error, critical
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES auth.users(id),
    
    -- Link to memory (for related memories about this error)
    memory_id BIGINT REFERENCES claude_desktop_memory(id),
    
    -- Notes and resolution
    notes TEXT,
    resolution TEXT,
    
    -- Embedding for semantic search
    embedding vector(1536)
);

-- Create indexes for performance
CREATE INDEX idx_ctk_error_logs_created_at ON ctk_error_logs(created_at DESC);
CREATE INDEX idx_ctk_error_logs_project ON ctk_error_logs(project_name);
CREATE INDEX idx_ctk_error_logs_error_type ON ctk_error_logs(error_type);
CREATE INDEX idx_ctk_error_logs_user_id ON ctk_error_logs(user_id);
CREATE INDEX idx_ctk_error_logs_resolved ON ctk_error_logs(resolved);
CREATE INDEX idx_ctk_error_logs_severity ON ctk_error_logs(severity);
CREATE INDEX idx_ctk_error_logs_tags ON ctk_error_logs USING gin(tags);

-- Add vector similarity search index
CREATE INDEX idx_ctk_error_logs_embedding ON ctk_error_logs 
USING hnsw (embedding vector_cosine_ops);

-- Enable RLS
ALTER TABLE ctk_error_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert errors (for anonymous error reporting)
CREATE POLICY "Anyone can insert errors" ON ctk_error_logs
    FOR INSERT 
    TO anon, authenticated
    WITH CHECK (true);

-- Policy: Users can read their own errors
CREATE POLICY "Users can read own errors" ON ctk_error_logs
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Policy: Project admins can read all project errors
CREATE POLICY "Project admins can read project errors" ON ctk_error_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM thr_employees 
            WHERE auth_user_id = auth.uid() 
            AND access_level >= 7
        )
    );

-- Policy: Admins can update errors (mark as resolved)
CREATE POLICY "Admins can update errors" ON ctk_error_logs
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM thr_employees 
            WHERE auth_user_id = auth.uid() 
            AND access_level >= 7
        )
    );

-- Create function to automatically create memory entry for critical errors
CREATE OR REPLACE FUNCTION create_error_memory()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create memory for critical errors
    IF NEW.severity = 'critical' THEN
        INSERT INTO claude_desktop_memory (
            user_id,
            content,
            metadata,
            importance,
            category,
            memory_type,
            owner,
            source
        ) VALUES (
            COALESCE(NEW.user_id, 'neo_todak'::uuid),
            format('Critical Error in %s: %s', NEW.project_name, NEW.error_message),
            jsonb_build_object(
                'error_id', NEW.id,
                'error_type', NEW.error_type,
                'project', NEW.project_name,
                'url', NEW.page_url,
                'stack_trace', NEW.error_stack
            ),
            8, -- High importance for critical errors
            'Error Tracking',
            'bug_fix',
            'neo_todak',
            'error_monitor'
        )
        RETURNING id INTO NEW.memory_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-create memories for critical errors
CREATE TRIGGER create_error_memory_trigger
    BEFORE INSERT ON ctk_error_logs
    FOR EACH ROW
    EXECUTE FUNCTION create_error_memory();

-- Create function to get error summary across all projects
CREATE OR REPLACE FUNCTION get_unified_error_summary(
    p_days INTEGER DEFAULT 7,
    p_project VARCHAR DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_summary JSON;
BEGIN
    SELECT json_build_object(
        'total_errors', COUNT(*),
        'unresolved_errors', COUNT(*) FILTER (WHERE NOT resolved),
        'critical_errors', COUNT(*) FILTER (WHERE severity = 'critical'),
        'projects_affected', (
            SELECT COUNT(DISTINCT project_name) 
            FROM ctk_error_logs 
            WHERE created_at >= NOW() - INTERVAL '1 day' * p_days
                AND (p_project IS NULL OR project_name = p_project)
        ),
        'errors_by_project', (
            SELECT json_object_agg(project_name, count)
            FROM (
                SELECT project_name, COUNT(*) as count
                FROM ctk_error_logs
                WHERE created_at >= NOW() - INTERVAL '1 day' * p_days
                    AND (p_project IS NULL OR project_name = p_project)
                GROUP BY project_name
                ORDER BY count DESC
            ) t
        ),
        'errors_by_type', (
            SELECT json_object_agg(error_type, count)
            FROM (
                SELECT error_type, COUNT(*) as count
                FROM ctk_error_logs
                WHERE created_at >= NOW() - INTERVAL '1 day' * p_days
                    AND (p_project IS NULL OR project_name = p_project)
                GROUP BY error_type
                ORDER BY count DESC
                LIMIT 10
            ) t
        ),
        'errors_by_severity', (
            SELECT json_object_agg(severity, count)
            FROM (
                SELECT severity, COUNT(*) as count
                FROM ctk_error_logs
                WHERE created_at >= NOW() - INTERVAL '1 day' * p_days
                    AND (p_project IS NULL OR project_name = p_project)
                GROUP BY severity
            ) t
        ),
        'recent_critical_errors', (
            SELECT json_agg(
                json_build_object(
                    'id', id,
                    'project', project_name,
                    'type', error_type,
                    'message', LEFT(error_message, 100),
                    'page', REGEXP_REPLACE(page_url, 'https?://[^/]+', ''),
                    'created_at', created_at,
                    'memory_id', memory_id
                )
            )
            FROM (
                SELECT id, project_name, error_type, error_message, page_url, created_at, memory_id
                FROM ctk_error_logs
                WHERE severity = 'critical' 
                    AND NOT resolved
                    AND created_at >= NOW() - INTERVAL '1 day' * p_days
                    AND (p_project IS NULL OR project_name = p_project)
                ORDER BY created_at DESC
                LIMIT 5
            ) t
        )
    ) INTO v_summary
    FROM ctk_error_logs
    WHERE created_at >= NOW() - INTERVAL '1 day' * p_days
        AND (p_project IS NULL OR project_name = p_project);
    
    RETURN v_summary;
END;
$$;

-- Create function to search similar errors using vector similarity
CREATE OR REPLACE FUNCTION search_similar_errors(
    p_error_message TEXT,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    error_id BIGINT,
    project_name VARCHAR,
    error_message TEXT,
    resolution TEXT,
    similarity FLOAT
)
LANGUAGE sql
AS $$
    SELECT 
        id as error_id,
        project_name,
        error_message,
        resolution,
        1 - (embedding <=> (
            SELECT embedding 
            FROM ctk_error_logs 
            WHERE error_message = p_error_message 
            LIMIT 1
        )) as similarity
    FROM ctk_error_logs
    WHERE embedding IS NOT NULL
        AND resolved = true
        AND resolution IS NOT NULL
    ORDER BY embedding <=> (
        SELECT embedding 
        FROM ctk_error_logs 
        WHERE error_message = p_error_message 
        LIMIT 1
    )
    LIMIT p_limit;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_unified_error_summary TO authenticated;
GRANT EXECUTE ON FUNCTION search_similar_errors TO authenticated;

-- Success message
SELECT json_build_object(
    'status', 'success',
    'message', 'Unified error logs table created in CTK memory database',
    'features', json_build_array(
        'Cross-project error tracking',
        'Automatic memory creation for critical errors',
        'Vector similarity search for solutions',
        'Integration with claude_desktop_memory',
        'Project-based filtering',
        'Severity levels',
        'Tag support'
    )
) as result;