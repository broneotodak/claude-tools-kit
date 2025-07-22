-- CTK Memory Constraint Fix
-- Issue: claude_desktop_memory table rejects source='claude_code'
-- Solution: Update constraint to include 'claude_code' as valid source

-- Drop existing constraint
ALTER TABLE claude_desktop_memory 
DROP CONSTRAINT IF EXISTS claude_desktop_memory_source_check;

-- Add updated constraint with all valid sources
ALTER TABLE claude_desktop_memory 
ADD CONSTRAINT claude_desktop_memory_source_check 
CHECK (source::text = ANY (ARRAY[
    'claude_desktop',
    'cursor', 
    'manual',
    'other',
    'claude_code'  -- NEW: Added for Claude Code integration
]::text[]));

-- Verify the update worked
SELECT 
    'Constraint updated successfully' as status,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conname = 'claude_desktop_memory_source_check';