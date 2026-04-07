-- ============================================================================
-- PHASE 1: Create Digital Twin Tables for Neo Mirror
-- ============================================================================
-- Purpose: Enable personal AI twin with structured knowledge extraction
-- Safety: All new tables, no modifications to existing tables
-- Rollback: DROP TABLE IF EXISTS for each table
-- Created: 2026-02-04
-- ============================================================================

-- ============================================================================
-- TABLE 1: neo_facts - Extracted knowledge and facts
-- ============================================================================
-- Stores discrete facts extracted from memories
-- Example: "Neo prefers React + TypeScript for frontend"

CREATE TABLE IF NOT EXISTS neo_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core fact data
    fact TEXT NOT NULL,
    fact_type TEXT NOT NULL DEFAULT 'general',
    -- Types: 'preference', 'skill', 'decision', 'pattern', 'knowledge', 'rule', 'general'

    -- Confidence and validation
    confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    evidence_count INTEGER DEFAULT 1,
    last_validated TIMESTAMPTZ,

    -- Source tracking (links to claude_desktop_memory)
    source_memory_ids INTEGER[],

    -- Semantic search
    embedding VECTOR(1536),

    -- Metadata
    domain TEXT,  -- 'tech', 'work', 'personal', 'project'
    tags TEXT[],
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for neo_facts
CREATE INDEX IF NOT EXISTS idx_neo_facts_type ON neo_facts(fact_type);
CREATE INDEX IF NOT EXISTS idx_neo_facts_domain ON neo_facts(domain);
CREATE INDEX IF NOT EXISTS idx_neo_facts_confidence ON neo_facts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_neo_facts_tags ON neo_facts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_neo_facts_embedding ON neo_facts USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON TABLE neo_facts IS 'Extracted facts and knowledge for Digital Twin - Neo Mirror';

-- ============================================================================
-- TABLE 2: neo_knowledge_graph - Entity relationships
-- ============================================================================
-- Stores relationships between entities for graph traversal
-- Example: Neo --uses--> React, Neo --owns--> THR Project

CREATE TABLE IF NOT EXISTS neo_knowledge_graph (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Triple: Subject -> Predicate -> Object
    subject TEXT NOT NULL,
    subject_type TEXT,  -- 'person', 'project', 'technology', 'concept', 'organization'

    predicate TEXT NOT NULL,
    -- Common predicates: 'uses', 'prefers', 'owns', 'knows', 'created',
    -- 'works_on', 'learned', 'avoids', 'decided', 'believes'

    object TEXT NOT NULL,
    object_type TEXT,

    -- Relationship strength
    weight FLOAT DEFAULT 1.0 CHECK (weight >= 0),
    evidence_count INTEGER DEFAULT 1,

    -- Source tracking
    source_memory_ids INTEGER[],
    first_observed TIMESTAMPTZ DEFAULT NOW(),
    last_observed TIMESTAMPTZ DEFAULT NOW(),

    -- Metadata
    context TEXT,  -- Additional context for the relationship
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint to prevent duplicates
    UNIQUE(subject, predicate, object)
);

-- Indexes for neo_knowledge_graph
CREATE INDEX IF NOT EXISTS idx_neo_kg_subject ON neo_knowledge_graph(subject);
CREATE INDEX IF NOT EXISTS idx_neo_kg_object ON neo_knowledge_graph(object);
CREATE INDEX IF NOT EXISTS idx_neo_kg_predicate ON neo_knowledge_graph(predicate);
CREATE INDEX IF NOT EXISTS idx_neo_kg_subject_type ON neo_knowledge_graph(subject_type);
CREATE INDEX IF NOT EXISTS idx_neo_kg_weight ON neo_knowledge_graph(weight DESC);

COMMENT ON TABLE neo_knowledge_graph IS 'Knowledge graph edges for Digital Twin - enables multi-hop reasoning';

-- ============================================================================
-- TABLE 3: neo_personality - Personality traits and patterns
-- ============================================================================
-- Stores quantified personality traits and behavioral patterns
-- Example: communication.directness = 0.85

CREATE TABLE IF NOT EXISTS neo_personality (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Trait identification
    trait TEXT NOT NULL,
    dimension TEXT NOT NULL,
    -- Dimensions: 'communication', 'decision_making', 'expertise',
    -- 'work_style', 'preferences', 'values'

    -- Trait value (normalized 0-1)
    value FLOAT NOT NULL CHECK (value >= 0 AND value <= 1),

    -- Statistical tracking
    sample_count INTEGER DEFAULT 1,
    std_deviation FLOAT,
    min_observed FLOAT,
    max_observed FLOAT,

    -- Evidence
    source_memory_ids INTEGER[],
    example_behaviors TEXT[],

    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated TIMESTAMPTZ DEFAULT NOW(),

    -- Unique trait per dimension
    UNIQUE(dimension, trait)
);

-- Indexes for neo_personality
CREATE INDEX IF NOT EXISTS idx_neo_personality_dimension ON neo_personality(dimension);
CREATE INDEX IF NOT EXISTS idx_neo_personality_value ON neo_personality(value DESC);

COMMENT ON TABLE neo_personality IS 'Quantified personality traits for Digital Twin - captures behavioral patterns';

-- ============================================================================
-- TABLE 4: activity_log - Activity tracking (for existing trigger)
-- ============================================================================
-- Note: This table is referenced by the memory sync trigger but didn't exist

CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core activity data
    user_id TEXT DEFAULT 'neo_todak',
    project_name TEXT,
    activity_type TEXT,
    activity_description TEXT,

    -- Rich metadata
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for activity_log
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_name);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

COMMENT ON TABLE activity_log IS 'Activity tracking - auto-populated by memory sync trigger';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
    AND table_name IN ('neo_facts', 'neo_knowledge_graph', 'neo_personality', 'activity_log')
ORDER BY table_name;

-- ============================================================================
-- SUCCESS CRITERIA:
-- 1. All 4 tables created
-- 2. All indexes created
-- 3. No errors
-- 4. Existing claude_desktop_memory UNTOUCHED
-- ============================================================================
