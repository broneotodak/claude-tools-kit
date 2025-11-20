#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log('🚀 Creating claude_grid_memory table in PGVector database...\n');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// SQL statements to execute
const sqlStatements = [
  {
    name: 'Create exec_sql function',
    sql: `
      CREATE OR REPLACE FUNCTION exec_sql(sql text)
      RETURNS void AS $$
      BEGIN
        EXECUTE sql;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `
  },
  {
    name: 'Enable UUID extension',
    sql: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
  },
  {
    name: 'Create grid memory table',
    sql: `
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
    `
  },
  {
    name: 'Create indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_grid_memory_user ON claude_grid_memory(user_id);
      CREATE INDEX IF NOT EXISTS idx_grid_memory_category ON claude_grid_memory(category);
      CREATE INDEX IF NOT EXISTS idx_grid_memory_parent ON claude_grid_memory(parent_memory_id);
      CREATE INDEX IF NOT EXISTS idx_grid_memory_type ON claude_grid_memory(relationship_type);
      CREATE INDEX IF NOT EXISTS idx_grid_memory_content ON claude_grid_memory USING GIN(to_tsvector('english', content));
      CREATE INDEX IF NOT EXISTS idx_grid_memory_metadata ON claude_grid_memory USING GIN(metadata);
      CREATE INDEX IF NOT EXISTS idx_grid_memory_created ON claude_grid_memory(created_at DESC);
    `
  },
  {
    name: 'Create view for connections',
    sql: `
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
    `
  },
  {
    name: 'Create helper function',
    sql: `
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
    `
  },
  {
    name: 'Enable RLS',
    sql: `ALTER TABLE claude_grid_memory ENABLE ROW LEVEL SECURITY;`
  },
  {
    name: 'Create RLS policy - SELECT',
    sql: `
      CREATE POLICY "Users can view own grid memories" ON claude_grid_memory
        FOR SELECT
        USING (user_id = 'neo_todak' OR owner = 'neo_todak');
    `
  },
  {
    name: 'Create RLS policy - INSERT',
    sql: `
      CREATE POLICY "Users can insert own grid memories" ON claude_grid_memory
        FOR INSERT
        WITH CHECK (user_id = 'neo_todak' OR owner = 'neo_todak');
    `
  },
  {
    name: 'Create RLS policy - UPDATE',
    sql: `
      CREATE POLICY "Users can update own grid memories" ON claude_grid_memory
        FOR UPDATE
        USING (user_id = 'neo_todak' OR owner = 'neo_todak');
    `
  },
  {
    name: 'Grant permissions',
    sql: `
      GRANT ALL ON claude_grid_memory TO authenticated;
      GRANT ALL ON claude_grid_memory TO anon;
    `
  },
  {
    name: 'Create update trigger function',
    sql: `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';
    `
  },
  {
    name: 'Create update trigger',
    sql: `
      CREATE TRIGGER update_grid_memory_updated_at 
        BEFORE UPDATE ON claude_grid_memory 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
    `
  }
];

async function executeStatement(statement) {
  try {
    console.log(`🔄 ${statement.name}...`);
    
    // Use the rpc function to execute raw SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: statement.sql.trim()
    });

    if (error) {
      // If exec_sql doesn't exist and this is the first statement, that's expected
      if (error.code === 'PGRST202' && statement.name === 'Create exec_sql function') {
        console.log(`⚠️  exec_sql function doesn't exist yet. Trying direct execution...`);
        // For the first statement, we need a different approach
        // This is expected to fail, but let's continue
        return false;
      }
      throw error;
    }

    console.log(`✅ ${statement.name} completed`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to execute "${statement.name}":`, error.message);
    return false;
  }
}

async function createGridMemoryTable() {
  console.log('📊 Target Database: uzamamymfzhelvkwpvgt.supabase.co');
  console.log('🎯 Creating claude_grid_memory table (independent of claude_desktop_memory)\n');

  let successCount = 0;
  let totalStatements = sqlStatements.length;

  for (const statement of sqlStatements) {
    const success = await executeStatement(statement);
    if (success) {
      successCount++;
    }
    
    // Small delay between statements
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n📈 Results: ${successCount}/${totalStatements} statements executed successfully`);

  // Verification
  console.log('\n🔍 Verifying table creation...');
  try {
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', 'claude_grid_memory');

    if (tablesError) {
      console.log('⚠️  Could not verify using information_schema, trying direct query...');
      
      // Try a simple select to verify table exists
      const { data: testQuery, error: testError } = await supabase
        .from('claude_grid_memory')
        .select('id')
        .limit(1);

      if (testError) {
        console.log('❌ Table verification failed:', testError.message);
      } else {
        console.log('✅ Table verification successful - claude_grid_memory exists and is accessible');
      }
    } else {
      console.log('✅ Table exists in information_schema');
    }

    // Show table structure
    console.log('\n📋 Checking table structure...');
    const { data: sample, error: sampleError } = await supabase
      .from('claude_grid_memory')
      .select('*')
      .limit(0); // Just get the structure

    if (!sampleError && sample !== null) {
      // The query succeeded, which means the table exists
      console.log('✅ Table structure confirmed - all columns accessible');
    }

  } catch (error) {
    console.error('Verification error:', error.message);
  }

  console.log('\n🎉 Grid memory table creation process completed!');
  console.log('\n📝 Next steps:');
  console.log('1. Test basic operations (insert, select, update)');
  console.log('2. Verify indexes are working properly');
  console.log('3. Test the helper functions and views');
  console.log('4. Begin using the grid memory system');

  return successCount === totalStatements;
}

// Execute the main function
createGridMemoryTable()
  .then(success => {
    if (success) {
      console.log('\n🚀 All operations completed successfully!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some operations failed. Please check the logs above.');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });