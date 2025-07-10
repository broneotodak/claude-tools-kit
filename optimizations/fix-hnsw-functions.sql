-- Fixed HNSW search functions with correct data types
-- Based on the error, id is INTEGER not UUID

-- Drop the incorrectly typed functions
DROP FUNCTION IF EXISTS match_desktop_memories_hnsw(vector, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories_filtered_hnsw(vector, jsonb, text, text, timestamptz, timestamptz, float, int);
DROP FUNCTION IF EXISTS match_desktop_memories(vector, float, int);

-- Create HNSW-optimized search function with INTEGER id
CREATE OR REPLACE FUNCTION match_desktop_memories_hnsw(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id integer,  -- Changed from uuid to integer
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
        cdm.id::integer,  -- Explicitly cast to integer
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

-- Create filtered search function with INTEGER id
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
    id integer,  -- Changed from uuid to integer
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
        cdm.id::integer,  -- Explicitly cast to integer
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

-- Create backward compatible wrapper with INTEGER id
CREATE OR REPLACE FUNCTION match_desktop_memories(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id integer,  -- Changed from uuid to integer
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

-- Now test with a proper query
-- First, let's get a real embedding to test with
WITH sample_embedding AS (
    SELECT embedding 
    FROM claude_desktop_memory 
    WHERE embedding IS NOT NULL 
    LIMIT 1
)
SELECT 
    id,
    LEFT(content, 100) as content_preview,
    similarity,
    metadata->>'project' as project,
    created_at
FROM match_desktop_memories_hnsw(
    (SELECT embedding FROM sample_embedding),
    0.5,  -- lower threshold to see more results
    5
)
ORDER BY similarity DESC;