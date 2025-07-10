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
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Function to execute SQL via Supabase admin API
async function executeSQLCommand(sql, description) {
  console.log(`\n🔧 ${description}...`);
  
  try {
    // For Supabase, we need to use a workaround since direct SQL execution
    // requires using the Management API or running commands individually
    
    // Option 1: Try using a function wrapper
    const functionName = `exec_${Date.now()}`;
    const createFunctionSQL = `
      CREATE OR REPLACE FUNCTION ${functionName}()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        ${sql}
      END;
      $$;
    `;
    
    // This approach won't work for CREATE INDEX CONCURRENTLY
    // So we'll provide instructions instead
    
    console.log('📋 SQL command prepared:');
    console.log('```sql');
    console.log(sql);
    console.log('```');
    
    return { success: false, needsManualExecution: true };
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

async function createHNSWIndexes() {
  console.log('🚀 Creating HNSW indexes for CTK memory system\n');
  console.log('⚠️  Note: Due to Supabase SQL Editor limitations, indexes need to be created individually\n');

  // First, let's check if we have the vector extension
  console.log('1️⃣ Checking vector extension...');
  
  // SQL commands that need to be executed
  const commands = [
    {
      sql: 'CREATE EXTENSION IF NOT EXISTS vector;',
      description: 'Enable vector extension'
    },
    {
      sql: 'DROP INDEX IF EXISTS claude_memories_embedding_hnsw_cosine_idx;',
      description: 'Drop existing cosine index'
    },
    {
      sql: `CREATE INDEX claude_memories_embedding_hnsw_cosine_idx 
            ON claude_memories 
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);`,
      description: 'Create HNSW cosine similarity index'
    },
    {
      sql: 'DROP INDEX IF EXISTS claude_memories_embedding_hnsw_l2_idx;',
      description: 'Drop existing L2 index'
    },
    {
      sql: `CREATE INDEX claude_memories_embedding_hnsw_l2_idx 
            ON claude_memories 
            USING hnsw (embedding vector_l2_ops)
            WITH (m = 16, ef_construction = 64);`,
      description: 'Create HNSW L2 distance index'
    },
    {
      sql: 'DROP INDEX IF EXISTS claude_memories_embedding_hnsw_ip_idx;',
      description: 'Drop existing inner product index'
    },
    {
      sql: `CREATE INDEX claude_memories_embedding_hnsw_ip_idx 
            ON claude_memories 
            USING hnsw (embedding vector_ip_ops)
            WITH (m = 16, ef_construction = 64);`,
      description: 'Create HNSW inner product index'
    }
  ];

  console.log('📝 Instructions for creating HNSW indexes:\n');
  console.log('Since Supabase SQL Editor runs commands in a transaction,');
  console.log('you need to run each command separately.\n');
  console.log('Copy and paste these commands ONE AT A TIME into the SQL Editor:\n');

  commands.forEach((cmd, index) => {
    console.log(`-- Step ${index + 1}: ${cmd.description}`);
    console.log(cmd.sql);
    console.log('');
  });

  // Create a bash script for easier execution
  const bashScript = `#!/bin/bash
# HNSW Index Creation Script for Supabase
# Run each command separately in the SQL Editor

echo "🚀 Creating HNSW indexes for CTK memory system"
echo ""
echo "Copy and run each of these commands in Supabase SQL Editor:"
echo ""

commands=(
${commands.map(cmd => `  "${cmd.sql.replace(/\n/g, ' ').replace(/\s+/g, ' ')}"`).join('\n')}
)

descriptions=(
${commands.map(cmd => `  "${cmd.description}"`).join('\n')}
)

for i in "\${!commands[@]}"; do
  echo "-- Step $((i+1)): \${descriptions[$i]}"
  echo "\${commands[$i]}"
  echo ""
  echo "Press Enter after running this command in SQL Editor..."
  read
done

echo "✅ All commands executed! Now run the verification script."
`;

  const scriptPath = path.join(__dirname, 'create-hnsw-indexes.sh');
  const fs = await import('fs');
  fs.writeFileSync(scriptPath, bashScript);
  fs.chmodSync(scriptPath, '755');
  
  console.log(`\n📄 Bash script created: create-hnsw-indexes.sh`);
  console.log('You can run it with: ./create-hnsw-indexes.sh\n');

  // Also save as a simple SQL file
  const sqlOnly = commands.map(cmd => `-- ${cmd.description}\n${cmd.sql}`).join('\n\n');
  const sqlPath = path.join(__dirname, 'hnsw-indexes-only.sql');
  fs.writeFileSync(sqlPath, sqlOnly);
  
  console.log(`📄 SQL file created: hnsw-indexes-only.sql`);
  console.log('Contains just the SQL commands without functions\n');

  console.log('🎯 Next steps:');
  console.log('1. Open Supabase SQL Editor');
  console.log('2. Run each command above ONE AT A TIME');
  console.log('3. Wait for each to complete before running the next');
  console.log('4. Run verify-hnsw-implementation.js to confirm\n');
  
  console.log('💡 Alternative: Use the fixed SQL file');
  console.log('   implement-hnsw-indexes-fixed.sql');
  console.log('   This version works in transaction mode');
}

// Run the script
createHNSWIndexes();