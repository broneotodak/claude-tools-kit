-- HNSW Index Implementation for CTK Memory System (Supabase Compatible)
-- This script implements high-performance HNSW indexes for pgvector
-- Fixed version that works with Supabase SQL Editor

-- ============================================
-- STEP 1: Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- STEP 2: Create HNSW indexes WITHOUT CONCURRENTLY
-- ============================================
-- Note: In Supabase SQL Editor, we cannot use CONCURRENTLY
-- The indexes will be created with a brief lock on the table

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS claude_memories_embedding_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_cosine_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_l2_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_ip_idx;

-- Main HNSW index for cosine similarity (most common for embeddings)
CREATE INDEX claude_memories_embedding_hnsw_cosine_idx 
ON claude_memories 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Additional HNSW index for L2 distance (Euclidean)
CREATE INDEX claude_memories_embedding_hnsw_l2_idx 
ON claude_memories 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for inner product
CREATE INDEX claude_memories_embedding_hnsw_ip_idx 
ON claude_memories 
USING hnsw (embedding vector_ip_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================
-- STEP 3: Set runtime parameters
-- ============================================
-- This will set the parameter for the current session
SET hnsw.ef_search = 40;

-- ============================================
-- STEP 4: Create optimized search functions
-- ============================================

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS match_memories(vector, float, int);
DROP FUNCTION IF EXISTS match_memories_hnsw(vector, float, int);
DROP FUNCTION IF EXISTS batch_match_memories_hnsw(vector[], float, int);
DROP FUNCTION IF EXISTS match_memories_filtered_hnsw(vector, jsonb, timestamptz, timestamptz, float, int);

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
-- STEP 5: Create performance monitoring view
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
-- STEP 6: Create backwards compatibility
-- ============================================
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
-- STEP 7: Analyze table for optimizer
-- ============================================
ANALYZE claude_memories;

-- ============================================
-- STEP 8: Verify index creation
-- ============================================
SELECT 
    'Index created successfully!' as status,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as size
FROM pg_indexes
WHERE tablename = 'claude_memories'
AND indexname LIKE '%hnsw%'
ORDER BY indexname;