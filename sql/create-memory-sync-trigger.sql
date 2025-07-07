-- FlowState Memory to Activity Auto-Sync Trigger
-- This trigger automatically creates an activity_log entry whenever a new memory is inserted
-- into claude_desktop_memory table, preserving all metadata

-- First, create a function that will be called by the trigger
CREATE OR REPLACE FUNCTION sync_memory_to_activity()
RETURNS TRIGGER AS $$
DECLARE
    v_project_name TEXT;
    v_activity_type TEXT;
    v_tool TEXT;
    v_description TEXT;
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
        jsonb_build_object(
            'source', 'memory_trigger',
            'memory_id', NEW.id,
            'memory_type', NEW.memory_type,
            'importance', NEW.importance,
            'timestamp', NEW.created_at
        ) || COALESCE(NEW.metadata, '{}'::jsonb), -- Merge with existing metadata
        NEW.created_at
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS memory_to_activity_sync_trigger ON claude_desktop_memory;

CREATE TRIGGER memory_to_activity_sync_trigger
    AFTER INSERT ON claude_desktop_memory
    FOR EACH ROW
    EXECUTE FUNCTION sync_memory_to_activity();

-- Add comment to document the trigger
COMMENT ON TRIGGER memory_to_activity_sync_trigger ON claude_desktop_memory IS 
'Automatically syncs new memories to activity_log table, preserving all metadata. Created by Claude Code on 2025-07-07.';

-- Test query to verify trigger exists
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'memory_to_activity_sync_trigger';