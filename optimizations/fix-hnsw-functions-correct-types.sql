-- Fixed HNSW search functions with CORRECT data types based on actual table structure
-- Using the exact types from the information_schema query

-- Drop existing functions
DROP FUNCTION IF EXISTS match_desktop_memories_hnsw(vector, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories_filtered_hnsw(vector, jsonb, text, text, timestamptz, timestamptz, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories(vector, float, int);

-- Create HNSW-optimized search function with CORRECT types
CREATE OR REPLACE FUNCTION match_desktop_memories_hnsw(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id integer,
    content text,
    similarity float,
    metadata jsonb,
    created_at timestamp,  -- Changed from timestamptz to timestamp
    owner varchar,
    source varchar,
    memory_type varchar
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

-- Test the function with a simple query
-- First get one embedding to use as test
DO $$
DECLARE
    test_embedding vector(1536);
BEGIN
    -- Get a sample embedding
    SELECT embedding INTO test_embedding
    FROM claude_desktop_memory
    WHERE embedding IS NOT NULL
    LIMIT 1;
    
    -- Test if we can call the function
    IF test_embedding IS NOT NULL THEN
        RAISE NOTICE 'Testing HNSW function...';
        
        -- Just try to execute it
        PERFORM * FROM match_desktop_memories_hnsw(test_embedding, 0.5, 3);
        
        RAISE NOTICE '✅ HNSW function works!';
    ELSE
        RAISE NOTICE '❌ No embeddings found to test with';
    END IF;
END $$;

-- Now actually run a test query to see results
WITH test_embedding AS (
    SELECT embedding 
    FROM claude_desktop_memory 
    WHERE embedding IS NOT NULL 
    LIMIT 1
)
SELECT 
    id,
    LEFT(content, 80) as content_preview,
    ROUND(similarity::numeric, 4) as similarity,
    created_at
FROM match_desktop_memories_hnsw(
    (SELECT embedding FROM test_embedding),
    0.3,  -- low threshold to ensure we get results
    5
)
ORDER BY similarity DESC;