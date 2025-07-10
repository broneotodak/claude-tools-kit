-- Verify HNSW performance and index usage - FIXED with correct column names

-- 1. Check index sizes
SELECT 
    indexname,
    pg_size_pretty(pg_relation_size(('public.' || indexname)::regclass)) as index_size
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE '%hnsw%'
ORDER BY indexname;

-- 2. Check index usage statistics - FIXED column names
SELECT 
    schemaname,
    indexrelname as index_name,  -- Correct column name
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND indexrelname LIKE '%hnsw%';

-- 3. Simple performance test
EXPLAIN ANALYZE
SELECT * FROM match_desktop_memories_hnsw(
    (SELECT embedding FROM claude_desktop_memory WHERE id = 208),
    0.5,
    10
);

-- 4. Check which indexes exist on the table
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'claude_desktop_memory'
AND schemaname = 'public'
ORDER BY indexname;