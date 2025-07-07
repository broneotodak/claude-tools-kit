-- Machine Name Normalization for FlowState
-- This updates the trigger to normalize machine names and cleans up existing data

-- First, create a function to normalize machine names
CREATE OR REPLACE FUNCTION normalize_machine_name(machine_name TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Handle null or empty
    IF machine_name IS NULL OR machine_name = '' THEN
        RETURN 'Unknown Machine';
    END IF;
    
    -- Normalize Windows/PC variations for your home setup
    IF machine_name IN ('NEO-MOTHERSHIP', 'Home PC', 'Windows PC', 'DESKTOP-NEO') OR
       machine_name ILIKE '%home%pc%' THEN
        RETURN 'Windows Home PC';
    END IF;
    
    -- Office PC normalization
    IF machine_name ILIKE '%office%pc%' OR machine_name = 'OFFICE-DESKTOP' THEN
        RETURN 'Office PC';
    END IF;
    
    -- Mac variations
    IF machine_name ILIKE 'macbook%' OR machine_name = 'mac' THEN
        -- Keep specific MacBook names if they have identifiers
        IF machine_name LIKE 'MacBook-Pro-%.local' THEN
            RETURN machine_name;
        ELSE
            RETURN 'MacBook Pro';
        END IF;
    END IF;
    
    -- Default: return as-is
    RETURN machine_name;
END;
$$ LANGUAGE plpgsql;

-- Update the sync trigger to use normalized machine names
CREATE OR REPLACE FUNCTION sync_memory_to_activity()
RETURNS TRIGGER AS $$
DECLARE
    v_project_name TEXT;
    v_activity_type TEXT;
    v_tool TEXT;
    v_description TEXT;
    v_machine TEXT;
BEGIN
    -- Extract project name from metadata or category
    v_project_name := COALESCE(
        NEW.metadata->>'project',
        NEW.category,
        'General'
    );
    
    -- Normalize common project names
    CASE v_project_name
        WHEN 'flowstate-ai' THEN v_project_name := 'FlowState AI';
        WHEN 'flowstate' THEN v_project_name := 'FlowState AI';
        WHEN 'claude-n' THEN v_project_name := 'ClaudeN';
        WHEN 'clauden' THEN v_project_name := 'ClaudeN';
        WHEN 'todak' THEN v_project_name := 'TODAK';
        WHEN 'todak-ai' THEN v_project_name := 'TODAK AI';
        ELSE v_project_name := v_project_name;
    END CASE;
    
    -- Extract tool from metadata
    v_tool := COALESCE(
        NEW.metadata->>'tool',
        NEW.metadata->>'actual_source',
        'AI Tool'
    );
    
    -- Normalize tool names
    CASE v_tool
        WHEN 'claude_code' THEN v_tool := 'Claude Code';
        WHEN 'Claude Desktop' THEN v_tool := 'Claude Desktop';
        WHEN 'cursor' THEN v_tool := 'Cursor';
        ELSE v_tool := v_tool;
    END CASE;
    
    -- Extract and normalize machine name
    v_machine := normalize_machine_name(
        COALESCE(NEW.metadata->>'machine', 'Unknown Machine')
    );
    
    -- Determine activity type
    v_activity_type := COALESCE(
        NEW.metadata->>'activity_type',
        CASE 
            WHEN NEW.memory_type = 'technical_solution' THEN 'development'
            WHEN NEW.memory_type = 'bug_fix' THEN 'debugging'
            WHEN NEW.memory_type = 'deployment' THEN 'deployment'
            WHEN NEW.memory_type = 'documentation' THEN 'documentation'
            ELSE 'development'
        END
    );
    
    -- Prepare description (truncate if too long)
    v_description := CASE 
        WHEN LENGTH(NEW.content) > 255 THEN 
            SUBSTRING(NEW.content FROM 1 FOR 252) || '...'
        ELSE 
            NEW.content
    END;
    
    -- Create metadata with normalized machine name
    DECLARE
        v_metadata JSONB;
    BEGIN
        v_metadata := COALESCE(NEW.metadata, '{}'::jsonb);
        v_metadata := v_metadata || jsonb_build_object(
            'source', 'memory_trigger',
            'memory_id', NEW.id,
            'memory_type', NEW.memory_type,
            'importance', NEW.importance,
            'timestamp', NEW.created_at,
            'machine', v_machine,  -- Use normalized machine name
            'tool', v_tool         -- Use normalized tool name
        );
        
        -- Insert into activity_log
        INSERT INTO activity_log (
            user_id,
            project_name,
            activity_type,
            activity_description,
            metadata,
            created_at
        ) VALUES (
            NEW.user_id,
            v_project_name,
            v_activity_type,
            v_description,
            v_metadata,
            NEW.created_at
        );
    END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Now update existing activities to normalize machine names
UPDATE activity_log
SET metadata = jsonb_set(
    metadata,
    '{machine}',
    to_jsonb(normalize_machine_name(metadata->>'machine'))
)
WHERE metadata->>'machine' IS NOT NULL;

-- Show count of updated records
SELECT 
    metadata->>'machine' as machine_name,
    COUNT(*) as count
FROM activity_log
WHERE metadata->>'machine' IS NOT NULL
GROUP BY metadata->>'machine'
ORDER BY count DESC;