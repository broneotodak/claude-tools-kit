-- Create projects table for automated project tracking
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) CHECK (category IN ('ai', 'automation', 'saas', 'tool', 'integration', 'research', 'game')),
    status VARCHAR(50) CHECK (status IN ('idea', 'planning', 'development', 'beta', 'active', 'maintenance', 'archived')),
    complexity INTEGER CHECK (complexity BETWEEN 1 AND 5),
    tech_stack TEXT[],
    links JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    icon VARCHAR(10),
    highlights TEXT[],
    challenges TEXT[],
    outcomes TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    auto_discovered BOOLEAN DEFAULT FALSE,
    source VARCHAR(50) DEFAULT 'manual',
    metadata JSONB DEFAULT '{}'
);

-- Create index for faster queries
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_category ON projects(category);
CREATE INDEX idx_projects_updated ON projects(updated_at DESC);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE
    ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for public project display
CREATE OR REPLACE VIEW public_projects AS
SELECT 
    project_id,
    name,
    description,
    category,
    status,
    complexity,
    tech_stack,
    links,
    metrics,
    icon,
    highlights,
    updated_at,
    last_activity
FROM projects
WHERE status NOT IN ('idea', 'planning', 'archived')
ORDER BY 
    CASE status
        WHEN 'active' THEN 1
        WHEN 'beta' THEN 2
        WHEN 'development' THEN 3
        WHEN 'maintenance' THEN 4
        ELSE 5
    END,
    last_activity DESC;

-- Grant permissions
GRANT SELECT ON public_projects TO anon;
GRANT ALL ON projects TO authenticated;

-- Create function to auto-discover projects from memories
CREATE OR REPLACE FUNCTION discover_projects_from_memories()
RETURNS void AS $$
DECLARE
    memory_record RECORD;
    project_name TEXT;
    project_status TEXT;
BEGIN
    -- Look for project-related memories
    FOR memory_record IN 
        SELECT DISTINCT ON (metadata->>'project') 
            metadata->>'project' as project,
            category,
            content,
            created_at,
            metadata
        FROM claude_desktop_memory
        WHERE 
            metadata->>'project' IS NOT NULL
            AND metadata->>'project' != ''
            AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY metadata->>'project', created_at DESC
    LOOP
        project_name := memory_record.project;
        
        -- Skip if already exists
        IF EXISTS (SELECT 1 FROM projects WHERE project_id = LOWER(REPLACE(project_name, ' ', '-'))) THEN
            CONTINUE;
        END IF;
        
        -- Determine status based on recent activity
        IF memory_record.created_at > NOW() - INTERVAL '7 days' THEN
            project_status := 'development';
        ELSE
            project_status := 'planning';
        END IF;
        
        -- Insert new project
        INSERT INTO projects (
            project_id,
            name,
            description,
            category,
            status,
            complexity,
            auto_discovered,
            source,
            metadata
        ) VALUES (
            LOWER(REPLACE(project_name, ' ', '-')),
            project_name,
            'Auto-discovered project from memory: ' || LEFT(memory_record.content, 200),
            COALESCE(
                CASE 
                    WHEN memory_record.category ILIKE '%ai%' THEN 'ai'
                    WHEN memory_record.category ILIKE '%automation%' THEN 'automation'
                    WHEN memory_record.category ILIKE '%tool%' THEN 'tool'
                    ELSE 'tool'
                END,
                'tool'
            ),
            project_status,
            3, -- Default complexity
            TRUE,
            'memory_discovery',
            jsonb_build_object(
                'discovered_from', 'claude_desktop_memory',
                'first_seen', memory_record.created_at,
                'original_metadata', memory_record.metadata
            )
        ) ON CONFLICT (project_id) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create scheduled job to run discovery (if using pg_cron)
-- SELECT cron.schedule('discover-projects', '0 * * * *', 'SELECT discover_projects_from_memories();');