-- ============================================================================
-- PHASE 2: Add Graph Memory Schema Fields
-- ============================================================================
-- Purpose: Enable GraphRAG capabilities and intelligent consolidation
-- Safety: All columns nullable, backward compatible, no data migration needed
-- Rollback: Safe to leave columns (they're nullable)
-- ============================================================================

-- Step 1: Add graph memory fields
ALTER TABLE claude_desktop_memory
ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS relationships JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS entity_count INTEGER DEFAULT 0;

-- Step 2: Add consolidation tracking fields
ALTER TABLE claude_desktop_memory
ADD COLUMN IF NOT EXISTS consolidated_from INTEGER[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS consolidation_date TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS consolidation_reason TEXT DEFAULT NULL;

-- Step 3: Add priority/decay tracking
ALTER TABLE claude_desktop_memory
ADD COLUMN IF NOT EXISTS priority_score FLOAT DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS last_consolidation TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS decay_factor FLOAT DEFAULT 1.0;

-- Step 4: Add indexes for new fields (for performance)
CREATE INDEX IF NOT EXISTS idx_memory_entities
ON claude_desktop_memory USING GIN (entities);

CREATE INDEX IF NOT EXISTS idx_memory_relationships
ON claude_desktop_memory USING GIN (relationships);

CREATE INDEX IF NOT EXISTS idx_memory_priority
ON claude_desktop_memory (priority_score DESC);

-- Step 5: Verify new columns exist
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'claude_desktop_memory'
    AND column_name IN (
        'entities',
        'relationships',
        'consolidated_from',
        'consolidation_date',
        'priority_score',
        'decay_factor'
    )
ORDER BY column_name;

-- ============================================================================
-- SUCCESS CRITERIA:
-- 1. All 9 new columns created
-- 2. All columns nullable (backward compatible)
-- 3. Indexes created on JSONB fields
-- 4. No errors
-- ============================================================================

-- Step 6: Add helpful comments
COMMENT ON COLUMN claude_desktop_memory.entities IS 'Extracted entities for GraphRAG (JSONB array)';
COMMENT ON COLUMN claude_desktop_memory.relationships IS 'Entity relationships for multi-hop reasoning (JSONB array)';
COMMENT ON COLUMN claude_desktop_memory.consolidated_from IS 'Source memory IDs if this is a consolidated memory';
COMMENT ON COLUMN claude_desktop_memory.priority_score IS 'Dynamic priority for retrieval (1.0 = normal, higher = more important)';
COMMENT ON COLUMN claude_desktop_memory.decay_factor IS 'Intelligent decay factor (1.0 = no decay, <1.0 = decaying)';
