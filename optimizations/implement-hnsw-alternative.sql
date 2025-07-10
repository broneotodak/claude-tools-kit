-- Alternative approach: Create HNSW indexes using Supabase CLI or API
-- This script generates the individual commands that can be run separately

-- ============================================
-- OPTION 1: Run these commands one by one in SQL Editor
-- ============================================

-- First, enable vector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Clean up any existing indexes
DROP INDEX IF EXISTS claude_memories_embedding_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_cosine_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_l2_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_ip_idx;

-- Create each index separately (run one at a time):

-- 1. Cosine similarity index
CREATE INDEX claude_memories_embedding_hnsw_cosine_idx 
ON claude_memories 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 2. L2 distance index
CREATE INDEX claude_memories_embedding_hnsw_l2_idx 
ON claude_memories 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- 3. Inner product index
CREATE INDEX claude_memories_embedding_hnsw_ip_idx 
ON claude_memories 
USING hnsw (embedding vector_ip_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================
-- OPTION 2: Use Supabase Management API
-- ============================================
-- You can also create indexes using the Supabase Management API
-- Here's a Node.js script to do it programmatically:

/*
const createIndexesViaAPI = async () => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `CREATE INDEX CONCURRENTLY claude_memories_embedding_hnsw_cosine_idx 
              ON claude_memories 
              USING hnsw (embedding vector_cosine_ops)
              WITH (m = 16, ef_construction = 64);`
    })
  });
  
  const result = await response.json();
  console.log('Index created:', result);
};
*/

-- ============================================
-- OPTION 3: Using psql directly
-- ============================================
-- If you have direct database access via psql:
/*
psql "$DATABASE_URL" -c "CREATE INDEX CONCURRENTLY claude_memories_embedding_hnsw_cosine_idx ON claude_memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);"
# Example DATABASE_URL format: See .env.template for the correct format
*/