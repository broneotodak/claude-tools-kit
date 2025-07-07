-- Fix Unknown Machine and Unknown Tool entries in FlowState
-- This script attempts to fix activities that show as "Unknown"

-- First, let's identify activities with Unknown Machine/Tool
WITH unknown_activities AS (
    SELECT 
        id,
        project_name,
        activity_description,
        metadata,
        created_at
    FROM activity_log
    WHERE metadata->>'machine' = 'Unknown Machine'
       OR metadata->>'machine' IS NULL
       OR metadata->>'tool' = 'Unknown Tool'
       OR metadata->>'tool' IS NULL
    ORDER BY created_at DESC
    LIMIT 20
)
SELECT * FROM unknown_activities;

-- Update activities based on patterns and context
-- Fix ClaudeN activities that should be Windows Home PC
UPDATE activity_log
SET metadata = jsonb_set(
    jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{machine}',
        '"Windows Home PC"'
    ),
    '{tool}',
    CASE 
        WHEN activity_description ILIKE '%claude code%' THEN '"Claude Code"'
        WHEN activity_description ILIKE '%claude.md%' THEN '"Claude Desktop"'
        WHEN project_name = 'ClaudeN' THEN '"Claude Desktop"'
        ELSE COALESCE(metadata->>'tool', '"AI Tool"')::jsonb
    END
)
WHERE (metadata->>'machine' = 'Unknown Machine' OR metadata->>'machine' IS NULL)
  AND project_name IN ('ClaudeN', 'FlowState AI')
  AND created_at::date = '2025-07-07';

-- Fix empty metadata objects
UPDATE activity_log
SET metadata = jsonb_build_object(
    'machine', 'Windows Home PC',
    'tool', CASE 
        WHEN project_name = 'FlowState AI' THEN 'Claude Code'
        WHEN project_name = 'ClaudeN' THEN 'Claude Desktop'
        ELSE 'AI Tool'
    END,
    'source', 'manual_fix',
    'fixed_at', NOW()
)
WHERE metadata = '{}'::jsonb
  AND created_at::date = '2025-07-07';

-- Show results after fix
SELECT 
    project_name,
    substring(activity_description, 1, 50) as description_preview,
    metadata->>'machine' as machine,
    metadata->>'tool' as tool,
    created_at
FROM activity_log
WHERE created_at::date = '2025-07-07'
ORDER BY created_at DESC
LIMIT 10;