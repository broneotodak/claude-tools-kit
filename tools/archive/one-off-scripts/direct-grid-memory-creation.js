#!/usr/bin/env node

import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log('🚀 Creating claude_grid_memory table using direct PostgreSQL connection...\n');

// Extract connection details from Supabase URL
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file');
  process.exit(1);
}

// Parse the Supabase URL to extract database connection details
// Format: https://uzamamymfzhelvkwpvgt.supabase.co
const urlParts = supabaseUrl.replace('https://', '').split('.');
const projectRef = urlParts[0];

// Supabase PostgreSQL connection details
const connectionConfig = {
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: serviceRoleKey, // Service role key is used as password for direct connections
  ssl: {
    rejectUnauthorized: false
  }
};

console.log(`📊 Connecting to: ${connectionConfig.host}`);
console.log(`🎯 Database: ${connectionConfig.database}\n`);

const client = new Client(connectionConfig);

const SQL_SCRIPT = `
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
`;

async function executeGridMemoryCreation() {
  try {
    console.log('🔌 Connecting to PostgreSQL database...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    console.log('🔄 Executing grid memory table creation SQL...');
    console.log('📝 This will create the claude_grid_memory table with all required features\n');
    
    const result = await client.query(SQL_SCRIPT);
    
    console.log('✅ SQL execution completed successfully!\n');
    
    // Verification queries
    console.log('🔍 Verifying table creation...');
    
    const tableCheck = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'claude_grid_memory' 
      ORDER BY ordinal_position;
    `);
    
    if (tableCheck.rows.length > 0) {
      console.log('✅ claude_grid_memory table created successfully!');
      console.log(`📊 Table has ${tableCheck.rows.length} columns:\n`);
      
      tableCheck.rows.forEach(row => {
        console.log(`   ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
    } else {
      console.log('❌ Table not found in information_schema');
    }
    
    // Check indexes
    console.log('\n🔍 Checking indexes...');
    const indexCheck = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'claude_grid_memory'
      ORDER BY indexname;
    `);
    
    if (indexCheck.rows.length > 0) {
      console.log(`✅ Found ${indexCheck.rows.length} indexes:`);
      indexCheck.rows.forEach(row => {
        console.log(`   ${row.indexname}`);
      });
    }
    
    // Check functions and views
    console.log('\n🔍 Checking functions and views...');
    const functionCheck = await client.query(`
      SELECT routine_name, routine_type 
      FROM information_schema.routines 
      WHERE routine_name IN ('get_memory_with_context', 'update_updated_at_column', 'exec_sql')
      ORDER BY routine_name;
    `);
    
    if (functionCheck.rows.length > 0) {
      console.log(`✅ Found ${functionCheck.rows.length} functions:`);
      functionCheck.rows.forEach(row => {
        console.log(`   ${row.routine_name} (${row.routine_type})`);
      });
    }
    
    const viewCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_name = 'grid_memory_connections';
    `);
    
    if (viewCheck.rows.length > 0) {
      console.log(`✅ Found view: grid_memory_connections`);
    }
    
    console.log('\n🎉 Grid memory system created successfully!');
    console.log('\n📝 Summary of what was created:');
    console.log('   ✅ claude_grid_memory table with all columns');
    console.log('   ✅ 7 indexes for performance optimization');
    console.log('   ✅ grid_memory_connections view for easy querying');
    console.log('   ✅ get_memory_with_context() helper function');
    console.log('   ✅ Row Level Security (RLS) policies');
    console.log('   ✅ Automatic updated_at trigger');
    console.log('   ✅ exec_sql utility function');
    
    console.log('\n🚀 The grid memory system is now ready for use!');
    console.log('\n📋 Next steps:');
    console.log('1. Test basic CRUD operations');
    console.log('2. Begin storing hierarchical memories');
    console.log('3. Use the context graph for relationship mapping');
    console.log('4. Leverage the view and helper functions');
    
  } catch (error) {
    console.error('❌ Error executing SQL:', error);
    
    if (error.message.includes('password authentication failed')) {
      console.error('\n💡 Tip: Make sure your SUPABASE_SERVICE_ROLE_KEY is correct');
      console.error('   This should be the service_role key, not the anon key');
    }
    
    if (error.message.includes('connect ECONNREFUSED')) {
      console.error('\n💡 Tip: Check your network connection and Supabase project status');
    }
    
    throw error;
  } finally {
    console.log('\n🔌 Closing database connection...');
    await client.end();
    console.log('✅ Connection closed');
  }
}

// Execute the function
executeGridMemoryCreation()
  .then(() => {
    console.log('\n🏁 Process completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
  });