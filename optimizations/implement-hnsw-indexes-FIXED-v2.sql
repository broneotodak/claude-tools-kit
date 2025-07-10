-- HNSW Index Implementation for CTK Memory System
-- FIXED VERSION 2 - Compatible with Supabase PostgreSQL
-- Using actual table: claude_desktop_memory

-- ============================================
-- STEP 1: Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- STEP 2: Verify table exists and check structure
-- ============================================
-- First, let's check if the table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'claude_desktop_memory'
) as table_exists;

-- ============================================
-- STEP 3: Drop existing indexes if they exist
-- ============================================
DROP INDEX IF EXISTS claude_desktop_memory_embedding_idx;
DROP INDEX IF EXISTS claude_desktop_memory_embedding_hnsw_cosine_idx;
DROP INDEX IF EXISTS claude_desktop_memory_embedding_hnsw_l2_idx;
DROP INDEX IF EXISTS claude_desktop_memory_embedding_hnsw_ip_idx;

-- ============================================
-- STEP 4: Create HNSW indexes
-- ============================================
-- Main HNSW index for cosine similarity
CREATE INDEX claude_desktop_memory_embedding_hnsw_cosine_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- L2 distance index
CREATE INDEX claude_desktop_memory_embedding_hnsw_l2_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Inner product index
CREATE INDEX claude_desktop_memory_embedding_hnsw_ip_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_ip_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================
-- STEP 5: Create optimized search functions
-- ============================================
-- Drop existing functions
DROP FUNCTION IF EXISTS match_desktop_memories(vector, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories_hnsw(vector, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories_filtered_hnsw(vector, jsonb, text, text, timestamptz, timestamptz, float, int);

-- Create HNSW-optimized search function
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

-- Create backward compatible wrapper
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
-- STEP 6: Analyze table
-- ============================================
ANALYZE claude_desktop_memory;

-- ============================================
-- STEP 7: Verify implementation
-- ============================================
-- Check indexes (using correct column names for Supabase)
SELECT 
    schemaname,
    indexname,
    pg_size_pretty(pg_relation_size(quote_ident(schemaname)||'.'||quote_ident(indexname)::regclass)) as index_size
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'claude_desktop_memory'
AND indexname LIKE '%hnsw%';

-- Check table statistics
SELECT 
    COUNT(*) as total_records,
    COUNT(embedding) as records_with_embeddings,
    ROUND((COUNT(embedding)::numeric / NULLIF(COUNT(*), 0) * 100), 2) as embedding_coverage_percent
FROM claude_desktop_memory;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ HNSW indexes created successfully!';
    RAISE NOTICE '📊 Run performance benchmarks to verify 3x improvement';
END $$;