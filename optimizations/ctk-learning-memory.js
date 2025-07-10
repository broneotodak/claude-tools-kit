import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function createLearningMemory() {
  console.log('📝 Creating CTK learning memory about assumptions...\n');
  
  const learningMemory = {
    user_id: 'neo_todak',
    memory_type: 'critical_learning',
    category: 'development_practices',
    content: `CRITICAL LEARNING - Avoid Assumptions in Database Operations

During HNSW optimization for CTK memory system, multiple incorrect assumptions were made:
1. Assumed table name was 'claude_memories' when it was actually 'claude_desktop_memory'
2. Assumed id column was UUID when it was actually INTEGER
3. Assumed created_at was timestamptz when it was actually timestamp
4. Assumed pg_stat_user_indexes column was 'indexname' when it was 'indexrelname'

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
- Use small test queries to validate assumptions`,
    metadata: {
      project: 'claude-tools-kit',
      importance_level: 'critical',
      error_type: 'incorrect_assumptions',
      affected_components: ['pgvector', 'HNSW', 'memory_search'],
      prevention_steps: [
        'Query structure first',
        'Never assume types',
        'Test before implementing',
        'Document actual findings'
      ],
      date: new Date().toISOString(),
      conversation_context: 'HNSW index optimization session'
    },
    importance: 10, // Maximum importance
    source: 'claude_code'
  };

  try {
    const { data, error } = await supabase
      .from('claude_desktop_memory')
      .insert(learningMemory)
      .select();

    if (error) {
      console.error('❌ Failed to create memory:', error);
      return;
    }

    console.log('✅ Learning memory created successfully!');
    console.log('Memory ID:', data[0].id);
    console.log('\n📚 This memory will help prevent similar assumption errors in future CTK interactions.');
    
    // Also create a summary for quick reference
    const summaryMemory = {
      user_id: 'neo_todak',
      memory_type: 'quick_reference',
      category: 'best_practices',
      content: 'CTK RULE: Always query actual database structure before operations. Never assume table names, column names, or data types.',
      metadata: {
        related_to: data[0].id,
        rule_type: 'database_operations',
        priority: 'critical'
      },
      importance: 10,
      source: 'claude_code'
    };

    const { data: summaryData, error: summaryError } = await supabase
      .from('claude_desktop_memory')
      .insert(summaryMemory)
      .select();

    if (!summaryError) {
      console.log('✅ Quick reference rule also saved!');
    }

  } catch (err) {
    console.error('❌ Error creating memory:', err);
  }
}

// Execute
createLearningMemory();