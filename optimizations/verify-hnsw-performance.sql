-- Verify HNSW performance and index usage

-- 1. Check index sizes
SELECT 
    indexname,
    pg_size_pretty(pg_relation_size(('public.' || indexname)::regclass)) as index_size,
    pg_size_pretty(pg_total_relation_size(('public.' || indexname)::regclass)) as total_size
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE '%hnsw%'
ORDER BY indexname;

-- 2. Check index usage statistics
SELECT 
    schemaname,
    indexname,
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND indexname LIKE '%hnsw%';

-- 3. Run a more complex similarity search to see HNSW in action
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT 
    cdm.id,
    cdm.content,
    1 - (cdm.embedding <=> (SELECT embedding FROM claude_desktop_memory WHERE id = 208)) AS similarity
FROM claude_desktop_memory cdm
WHERE cdm.embedding IS NOT NULL
AND 1 - (cdm.embedding <=> (SELECT embedding FROM claude_desktop_memory WHERE id = 208)) >= 0.5
ORDER BY cdm.embedding <=> (SELECT embedding FROM claude_desktop_memory WHERE id = 208)
LIMIT 10;

-- 4. Performance comparison: Sequential scan vs HNSW
-- Force sequential scan (for comparison)
SET enable_indexscan = OFF;
EXPLAIN ANALYZE
SELECT COUNT(*) FROM (
    SELECT 1 
    FROM claude_desktop_memory cdm
    WHERE cdm.embedding IS NOT NULL
    AND 1 - (cdm.embedding <=> (SELECT embedding FROM claude_desktop_memory WHERE id = 208)) >= 0.7
    LIMIT 10
) t;

-- Re-enable index scan
SET enable_indexscan = ON;
EXPLAIN ANALYZE
SELECT COUNT(*) FROM (
    SELECT 1 
    FROM claude_desktop_memory cdm
    WHERE cdm.embedding IS NOT NULL
    AND 1 - (cdm.embedding <=> (SELECT embedding FROM claude_desktop_memory WHERE id = 208)) >= 0.7
    LIMIT 10
) t;

-- 5. Test batch performance
EXPLAIN ANALYZE
WITH test_ids AS (
    SELECT id, embedding 
    FROM claude_desktop_memory 
    WHERE embedding IS NOT NULL 
    ORDER BY id 
    LIMIT 5
)
SELECT 
    t.id as query_id,
    COUNT(*) as matches_found
FROM test_ids t
CROSS JOIN LATERAL (
    SELECT 1
    FROM match_desktop_memories_hnsw(t.embedding, 0.7, 5)
) m
GROUP BY t.id;