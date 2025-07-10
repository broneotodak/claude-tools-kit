-- Create CTK learning memory about avoiding assumptions

INSERT INTO claude_desktop_memory (
    user_id,
    memory_type,
    category,
    content,
    metadata,
    importance,
    source,
    created_at
) VALUES (
    'neo_todak',
    'critical_learning',
    'development_practices',
    'CRITICAL LEARNING - Avoid Assumptions in Database Operations

During HNSW optimization for CTK memory system, multiple incorrect assumptions were made:
1. Assumed table name was ''claude_memories'' when it was actually ''claude_desktop_memory''
2. Assumed id column was UUID when it was actually INTEGER
3. Assumed created_at was timestamptz when it was actually timestamp
4. Assumed pg_stat_user_indexes column was ''indexname'' when it was ''indexrelname''

CORRECT APPROACH:
1. ALWAYS query information_schema or pg_catalog first to verify structure
2. NEVER assume column names, types, or table names
3. Use exact types from queries, not "common" patterns
4. Test with actual data before proposing solutions

IMPACT: Assumptions can lead to critical errors in production systems. The CTK system should help PREVENT assumptions, not enable them.

SOLUTION: Before any database operation:
- Query information_schema.columns for exact structure
- Query pg_indexes/pg_stat_user_indexes with correct column names
- Verify table existence before operations
- Use small test queries to validate assumptions',
    jsonb_build_object(
        'project', 'claude-tools-kit',
        'importance_level', 'critical',
        'error_type', 'incorrect_assumptions',
        'affected_components', ARRAY['pgvector', 'HNSW', 'memory_search'],
        'prevention_steps', ARRAY[
            'Query structure first',
            'Never assume types',
            'Test before implementing',
            'Document actual findings'
        ],
        'date', '2025-07-09',
        'conversation_context', 'HNSW index optimization session'
    ),
    10, -- Maximum importance
    'claude_code',
    NOW()
);

-- Also create a quick reference rule
INSERT INTO claude_desktop_memory (
    user_id,
    memory_type,
    category,
    content,
    metadata,
    importance,
    source,
    created_at
) VALUES (
    'neo_todak',
    'quick_reference',
    'best_practices',
    'CTK RULE: Always query actual database structure before operations. Never assume table names, column names, or data types.',
    jsonb_build_object(
        'rule_type', 'database_operations',
        'priority', 'critical',
        'created_from', 'HNSW optimization learning'
    ),
    10,
    'claude_code',
    NOW()
);

-- Verify the memories were created
SELECT 
    id,
    memory_type,
    LEFT(content, 100) as content_preview,
    created_at
FROM claude_desktop_memory
WHERE source = 'claude_code'
AND created_at > NOW() - INTERVAL '1 minute'
ORDER BY created_at DESC;