-- Check the actual structure of claude_desktop_memory table
SELECT 
    column_name, 
    data_type,
    udt_name,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'claude_desktop_memory' 
ORDER BY ordinal_position;