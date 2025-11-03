-- Check what values are allowed for source field

SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'claude_desktop_memory'::regclass
    AND conname LIKE '%source%';
