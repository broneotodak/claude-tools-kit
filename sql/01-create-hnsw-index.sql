-- ============================================================================
-- PHASE 1: Create HNSW Index for Performance Boost
-- ============================================================================
-- Purpose: 2-3x faster vector similarity queries
-- Safety: CONCURRENTLY = non-blocking, table remains accessible
-- Expected build time: ~30 seconds for 2,930 vectors
-- Rollback: DROP INDEX IF EXISTS memory_embedding_hnsw_idx;
-- ============================================================================

-- Step 1: Check current indexes
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'claude_desktop_memory'
ORDER BY indexname;

-- Step 2: Create HNSW index (CONCURRENTLY = safe, non-blocking)
-- Parameters:
--   m = 16              : number of connections per layer (balanced)
--   ef_construction = 64: quality during build (good accuracy)
--   vector_cosine_ops   : cosine distance (standard for embeddings)

CREATE INDEX CONCURRENTLY IF NOT EXISTS memory_embedding_hnsw_idx
ON claude_desktop_memory
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Step 3: Verify index was created
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'claude_desktop_memory'
    AND indexname = 'memory_embedding_hnsw_idx';

-- Step 4: Test the index with a sample query
-- This forces PostgreSQL to use the new index
SELECT id, content, importance
FROM claude_desktop_memory
ORDER BY embedding <=> (SELECT embedding FROM claude_desktop_memory LIMIT 1)
LIMIT 5;

-- ============================================================================
-- SUCCESS CRITERIA:
-- 1. Index appears in pg_indexes
-- 2. Query returns results quickly
-- 3. No errors during creation
-- ============================================================================
