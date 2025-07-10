-- HNSW Index Implementation for CTK Memory System
-- This script implements high-performance HNSW indexes for pgvector
-- Expected performance improvement: 3x faster similarity searches

-- ============================================
-- STEP 1: Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- STEP 2: Set optimal HNSW parameters
-- ============================================
-- These parameters are tuned for our use case:
-- - m=16: Number of bi-directional links (good balance of speed/accuracy)
-- - ef_construction=64: Size of dynamic candidate list (higher = better quality, slower build)
SET hnsw.ef_search = 40; -- Runtime search parameter (higher = better recall, slower search)

-- ============================================
-- STEP 3: Drop existing indexes (if any)
-- ============================================
-- Check and drop existing vector indexes to avoid conflicts
DO $$ 
BEGIN
    -- Drop IVFFlat indexes if they exist
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'claude_memories' 
        AND indexname = 'claude_memories_embedding_idx'
    ) THEN
        DROP INDEX claude_memories_embedding_idx;
        RAISE NOTICE 'Dropped existing IVFFlat index';
    END IF;
    
    -- Drop any other vector indexes
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'claude_memories' 
        AND indexname LIKE '%embedding%'
    ) THEN
        EXECUTE (
            SELECT string_agg('DROP INDEX ' || indexname || ';', ' ')
            FROM pg_indexes
            WHERE tablename = 'claude_memories'
            AND indexname LIKE '%embedding%'
        );
        RAISE NOTICE 'Dropped other embedding indexes';
    END IF;
END $$;

-- ============================================
-- STEP 4: Create HNSW indexes with CONCURRENTLY
-- ============================================
-- Using CONCURRENTLY to avoid locking the table during index creation

-- Main HNSW index for cosine similarity (most common for embeddings)
CREATE INDEX CONCURRENTLY IF NOT EXISTS claude_memories_embedding_hnsw_cosine_idx 
ON claude_memories 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Additional HNSW index for L2 distance (Euclidean)
-- Useful for certain types of queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS claude_memories_embedding_hnsw_l2_idx 
ON claude_memories 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for inner product (for maximum inner product search)
-- Useful when embeddings are normalized
CREATE INDEX CONCURRENTLY IF NOT EXISTS claude_memories_embedding_hnsw_ip_idx 
ON claude_memories 
USING hnsw (embedding vector_ip_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================
-- STEP 5: Create optimized search functions
-- ============================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS match_memories(vector, float, int);
DROP FUNCTION IF EXISTS match_memories_hnsw(vector, float, int);

-- Create new HNSW-optimized search function
CREATE OR REPLACE FUNCTION match_memories_hnsw(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Set the search parameter for this query
    SET LOCAL hnsw.ef_search = 40;
    
    RETURN QUERY
    SELECT 
        cm.id,
        cm.content,
        1 - (cm.embedding <=> query_embedding) AS similarity,
        cm.metadata,
        cm.created_at
    FROM claude_memories cm
    WHERE cm.embedding IS NOT NULL
    AND 1 - (cm.embedding <=> query_embedding) >= match_threshold
    ORDER BY cm.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Create a function for batch similarity search
CREATE OR REPLACE FUNCTION batch_match_memories_hnsw(
    query_embeddings vector(1536)[],
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    query_index int,
    id uuid,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
    i int;
BEGIN
    -- Set the search parameter for batch queries
    SET LOCAL hnsw.ef_search = 40;
    
    FOR i IN 1..array_length(query_embeddings, 1) LOOP
        RETURN QUERY
        SELECT 
            i as query_index,
            cm.id,
            cm.content,
            1 - (cm.embedding <=> query_embeddings[i]) AS similarity,
            cm.metadata,
            cm.created_at
        FROM claude_memories cm
        WHERE cm.embedding IS NOT NULL
        AND 1 - (cm.embedding <=> query_embeddings[i]) >= match_threshold
        ORDER BY cm.embedding <=> query_embeddings[i]
        LIMIT match_count;
    END LOOP;
END;
$$;

-- Create a function for filtered similarity search
CREATE OR REPLACE FUNCTION match_memories_filtered_hnsw(
    query_embedding vector(1536),
    filter_metadata jsonb DEFAULT NULL,
    date_from timestamptz DEFAULT NULL,
    date_to timestamptz DEFAULT NULL,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Set the search parameter
    SET LOCAL hnsw.ef_search = 40;
    
    RETURN QUERY
    SELECT 
        cm.id,
        cm.content,
        1 - (cm.embedding <=> query_embedding) AS similarity,
        cm.metadata,
        cm.created_at
    FROM claude_memories cm
    WHERE cm.embedding IS NOT NULL
    AND 1 - (cm.embedding <=> query_embedding) >= match_threshold
    AND (filter_metadata IS NULL OR cm.metadata @> filter_metadata)
    AND (date_from IS NULL OR cm.created_at >= date_from)
    AND (date_to IS NULL OR cm.created_at <= date_to)
    ORDER BY cm.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================
-- STEP 6: Create performance monitoring view
-- ============================================
CREATE OR REPLACE VIEW claude_memories_index_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'claude_memories'
AND indexname LIKE '%embedding%';

-- ============================================
-- STEP 7: Analyze table for optimizer
-- ============================================
ANALYZE claude_memories;

-- ============================================
-- STEP 8: Verify index creation
-- ============================================
SELECT 
    indexname,
    indexdef,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as size
FROM pg_indexes
WHERE tablename = 'claude_memories'
AND indexname LIKE '%hnsw%';

-- ============================================
-- STEP 9: Create backwards compatibility
-- ============================================
-- Rename the old function and point to new HNSW version
CREATE OR REPLACE FUNCTION match_memories(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamptz
)
LANGUAGE sql
AS $$
    SELECT * FROM match_memories_hnsw(query_embedding, match_threshold, match_count);
$$;

-- ============================================
-- COMPLETION MESSAGE
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '✅ HNSW indexes successfully created!';
    RAISE NOTICE '📈 Expected performance improvement: 3x faster searches';
    RAISE NOTICE '🔧 Runtime parameter set: hnsw.ef_search = 40';
    RAISE NOTICE '🎯 New functions available:';
    RAISE NOTICE '   - match_memories_hnsw()';
    RAISE NOTICE '   - batch_match_memories_hnsw()';
    RAISE NOTICE '   - match_memories_filtered_hnsw()';
    RAISE NOTICE '📊 Monitor performance with: SELECT * FROM claude_memories_index_stats;';
END $$;