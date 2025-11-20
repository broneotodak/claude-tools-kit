# Manual Grid Memory Table Creation Instructions

Since the API-based SQL execution is not working due to PostgREST limitations, you need to manually execute the SQL in the Supabase SQL Editor.

## Steps to Execute:

### 1. Open Supabase SQL Editor
Go to: **https://supabase.com/dashboard/project/uzamamymfzhelvkwpvgt/sql/new**

### 2. Copy and Execute the Following SQL

```sql
-- Manual Grid Memory Table Creation for PGVector Database
-- Database: https://uzamamymfzhelvkwpvgt.supabase.co
-- Execute this SQL in the Supabase SQL editor

-- Step 1: Create exec_sql function first
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 3: Create the grid memory table
CREATE TABLE IF NOT EXISTS claude_grid_memory (
  -- Standard memory fields (matching existing structure)
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'neo_todak',
  owner TEXT DEFAULT 'neo_todak',
  memory_type TEXT,
  category TEXT,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  importance INTEGER DEFAULT 5,
  source TEXT DEFAULT 'grid_memory',
  
  -- Grid-specific fields (NEW)
  parent_memory_id UUID REFERENCES claude_grid_memory(id) ON DELETE SET NULL,
  child_memories UUID[] DEFAULT '{}',
  context_graph JSONB DEFAULT '{}',
  relationship_type TEXT,
  confidence_score FLOAT DEFAULT 0.5,
  
  -- Embeddings for semantic search (compatible with existing)
  embedding vector(1536),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT importance_range CHECK (importance >= 1 AND importance <= 10)
);

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_grid_memory_user ON claude_grid_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_grid_memory_category ON claude_grid_memory(category);
CREATE INDEX IF NOT EXISTS idx_grid_memory_parent ON claude_grid_memory(parent_memory_id);
CREATE INDEX IF NOT EXISTS idx_grid_memory_type ON claude_grid_memory(relationship_type);
CREATE INDEX IF NOT EXISTS idx_grid_memory_content ON claude_grid_memory USING GIN(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_grid_memory_metadata ON claude_grid_memory USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_grid_memory_created ON claude_grid_memory(created_at DESC);

-- Step 5: Create view for connections
CREATE OR REPLACE VIEW grid_memory_connections AS
SELECT 
  m1.id as memory_id,
  m1.content as memory_content,
  m1.relationship_type,
  m1.confidence_score,
  m1.importance,
  m2.id as connected_id,
  m2.content as connected_content,
  m1.metadata->>'grid_context' as context,
  m1.created_at
FROM claude_grid_memory m1
LEFT JOIN claude_grid_memory m2 ON m2.parent_memory_id = m1.id
WHERE m1.user_id = 'neo_todak'
ORDER BY m1.created_at DESC;

-- Step 6: Create helper function
CREATE OR REPLACE FUNCTION get_memory_with_context(memory_id UUID)
RETURNS TABLE (
  id UUID,
  content TEXT,
  parent_content TEXT,
  child_contents TEXT[],
  context JSONB,
  implications TEXT[],
  confidence FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.content,
    p.content as parent_content,
    ARRAY(
      SELECT c.content 
      FROM claude_grid_memory c 
      WHERE m.id = ANY(c.child_memories)
    ) as child_contents,
    m.metadata->'grid_context' as context,
    ARRAY(
      SELECT jsonb_array_elements_text(m.metadata->'implications')
    ) as implications,
    m.confidence_score
  FROM claude_grid_memory m
  LEFT JOIN claude_grid_memory p ON p.id = m.parent_memory_id
  WHERE m.id = memory_id;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Enable RLS
ALTER TABLE claude_grid_memory ENABLE ROW LEVEL SECURITY;

-- Step 8: Create RLS policies
CREATE POLICY "Users can view own grid memories" ON claude_grid_memory
  FOR SELECT
  USING (user_id = 'neo_todak' OR owner = 'neo_todak');

CREATE POLICY "Users can insert own grid memories" ON claude_grid_memory
  FOR INSERT
  WITH CHECK (user_id = 'neo_todak' OR owner = 'neo_todak');

CREATE POLICY "Users can update own grid memories" ON claude_grid_memory
  FOR UPDATE
  USING (user_id = 'neo_todak' OR owner = 'neo_todak');

-- Step 9: Grant permissions
GRANT ALL ON claude_grid_memory TO authenticated;
GRANT ALL ON claude_grid_memory TO anon;

-- Step 10: Create update trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_grid_memory_updated_at 
  BEFORE UPDATE ON claude_grid_memory 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Step 11: Verification query
SELECT 'Grid Memory table created successfully!' as status,
       'Original claude_desktop_memory table remains unchanged' as note,
       'To rollback: DROP TABLE claude_grid_memory CASCADE;' as rollback_info;
```

### 3. Verify Creation

After running the SQL, execute this verification query:

```sql
-- Verify table structure
SELECT table_name FROM information_schema.tables WHERE table_name = 'claude_grid_memory';

-- Check columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'claude_grid_memory' 
ORDER BY ordinal_position;

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'claude_grid_memory';

-- Test basic functionality
INSERT INTO claude_grid_memory (content, category, metadata) 
VALUES ('Test grid memory entry', 'test', '{"test": true}');

SELECT id, content, created_at FROM claude_grid_memory WHERE category = 'test';
```

### 4. Expected Results

If successful, you should see:
- ✅ `claude_grid_memory` table created with all columns
- ✅ 7 performance indexes created
- ✅ `grid_memory_connections` view created
- ✅ `get_memory_with_context()` function created
- ✅ Row Level Security policies enabled
- ✅ Automatic `updated_at` trigger working

### 5. Rollback (if needed)

If something goes wrong, you can rollback with:

```sql
DROP TABLE claude_grid_memory CASCADE;
DROP FUNCTION IF EXISTS get_memory_with_context(UUID);
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS exec_sql(text);
```

## Important Notes

- ⚠️  This creates a **NEW** table (`claude_grid_memory`) separate from `claude_desktop_memory`
- ✅ The original memory table remains **completely unchanged**
- 🔒 Row Level Security is enabled with policies for `neo_todak`
- 📊 All indexes are optimized for performance
- 🔗 The table supports hierarchical relationships and context graphs

## Troubleshooting

If you encounter errors:

1. **"relation already exists"** - Table already created, skip to verification
2. **"function already exists"** - Functions already created, continue with next steps
3. **"permission denied"** - Make sure you're using the service role key
4. **"column does not exist"** - Vector extension may not be enabled

The grid memory system will be ready for use once this SQL is successfully executed!