-- HNSW Index Implementation for CTK Memory System
-- CORRECTED VERSION - Using actual table: claude_desktop_memory
-- This script implements high-performance HNSW indexes for pgvector

-- ============================================
-- VERIFY TABLE STRUCTURE FIRST
-- ============================================
-- Let's first verify the table exists and has the embedding column
SELECT 
    column_name, 
    data_type, 
    character_maximum_length
FROM information_schema.columns
WHERE table_name = 'claude_desktop_memory'
ORDER BY ordinal_position;

-- ============================================
-- STEP 1: Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- STEP 2: Check existing indexes on claude_desktop_memory
-- ============================================
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'claude_desktop_memory'
AND indexname LIKE '%embedding%';

-- ============================================
-- STEP 3: Create HNSW indexes for claude_desktop_memory
-- ============================================
-- Drop existing indexes if they exist
DROP INDEX IF EXISTS claude_desktop_memory_embedding_idx;
DROP INDEX IF EXISTS claude_desktop_memory_embedding_hnsw_cosine_idx;
DROP INDEX IF EXISTS claude_desktop_memory_embedding_hnsw_l2_idx;
DROP INDEX IF EXISTS claude_desktop_memory_embedding_hnsw_ip_idx;

-- Main HNSW index for cosine similarity (most common for embeddings)
CREATE INDEX claude_desktop_memory_embedding_hnsw_cosine_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Additional HNSW index for L2 distance (Euclidean)
CREATE INDEX claude_desktop_memory_embedding_hnsw_l2_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for inner product
CREATE INDEX claude_desktop_memory_embedding_hnsw_ip_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_ip_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================
-- STEP 4: Set runtime parameters
-- ============================================
SET hnsw.ef_search = 40;

-- ============================================
-- STEP 5: Create optimized search functions
-- ============================================

-- Check if match_desktop_memories function exists
DROP FUNCTION IF EXISTS match_desktop_memories(vector, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories_hnsw(vector, float, int);

-- Create new HNSW-optimized search function
CREATE OR REPLACE FUNCTION match_desktop_memories_hnsw(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamptz,
    owner text,
    source text,
    memory_type text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cdm.id,
        cdm.content,
        1 - (cdm.embedding <=> query_embedding) AS similarity,
        cdm.metadata,
        cdm.created_at,
        cdm.owner,
        cdm.source,
        cdm.memory_type
    FROM claude_desktop_memory cdm
    WHERE cdm.embedding IS NOT NULL
    AND 1 - (cdm.embedding <=> query_embedding) >= match_threshold
    ORDER BY cdm.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Create filtered search function
CREATE OR REPLACE FUNCTION match_desktop_memories_filtered_hnsw(
    query_embedding vector(1536),
    filter_metadata jsonb DEFAULT NULL,
    filter_source text DEFAULT NULL,
    filter_memory_type text DEFAULT NULL,
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
    created_at timestamptz,
    owner text,
    source text,
    memory_type text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cdm.id,
        cdm.content,
        1 - (cdm.embedding <=> query_embedding) AS similarity,
        cdm.metadata,
        cdm.created_at,
        cdm.owner,
        cdm.source,
        cdm.memory_type
    FROM claude_desktop_memory cdm
    WHERE cdm.embedding IS NOT NULL
    AND 1 - (cdm.embedding <=> query_embedding) >= match_threshold
    AND (filter_metadata IS NULL OR cdm.metadata @> filter_metadata)
    AND (filter_source IS NULL OR cdm.source = filter_source)
    AND (filter_memory_type IS NULL OR cdm.memory_type = filter_memory_type)
    AND (date_from IS NULL OR cdm.created_at >= date_from)
    AND (date_to IS NULL OR cdm.created_at <= date_to)
    ORDER BY cdm.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================
-- STEP 6: Create performance monitoring view
-- ============================================
CREATE OR REPLACE VIEW claude_desktop_memory_index_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'claude_desktop_memory'
AND indexname LIKE '%embedding%';

-- ============================================
-- STEP 7: Update existing functions if they exist
-- ============================================
-- Create backward compatible function
CREATE OR REPLACE FUNCTION match_desktop_memories(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamptz,
    owner text,
    source text,
    memory_type text
)
LANGUAGE sql
AS $$
    SELECT * FROM match_desktop_memories_hnsw(query_embedding, match_threshold, match_count);
$$;

-- ============================================
-- STEP 8: Analyze table for optimizer
-- ============================================
ANALYZE claude_desktop_memory;

-- ============================================
-- STEP 9: Verify implementation
-- ============================================
-- Check created indexes
SELECT 
    'HNSW Index Created' as status,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as size
FROM pg_indexes
WHERE tablename = 'claude_desktop_memory'
AND indexname LIKE '%hnsw%'
ORDER BY indexname;

-- Check embedding statistics
SELECT 
    COUNT(*) as total_records,
    COUNT(embedding) as records_with_embeddings,
    (COUNT(embedding)::float / COUNT(*)::float * 100)::numeric(5,2) as embedding_coverage_percent
FROM claude_desktop_memory;