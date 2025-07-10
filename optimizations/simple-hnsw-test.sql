-- Simple test to create HNSW indexes
-- Run each section separately if needed

-- 1. First check if table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%memory%';

-- 2. Check columns of claude_desktop_memory
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'claude_desktop_memory' 
ORDER BY ordinal_position;

-- 3. Create just one HNSW index to test
CREATE INDEX test_hnsw_idx 
ON claude_desktop_memory 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 4. Check if index was created
SELECT indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE '%hnsw%';