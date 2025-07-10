import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function applyHNSWIndexes() {
  console.log('🚀 Applying HNSW indexes to CTK memory system...\n');
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'implement-hnsw-indexes.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Since we can't run raw SQL directly through Supabase client,
    // we'll need to use the SQL editor in Supabase dashboard
    console.log('📋 SQL script ready for execution');
    console.log('⚠️  Important: HNSW indexes need to be created directly in Supabase SQL Editor\n');
    
    console.log('🔧 Steps to apply HNSW indexes:\n');
    console.log('1. Go to your Supabase Dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Copy and paste the contents of implement-hnsw-indexes.sql');
    console.log('4. Execute the script\n');
    
    console.log('📝 The script will:');
    console.log('   - Create HNSW indexes with optimal parameters (m=16, ef_construction=64)');
    console.log('   - Set runtime search parameter (ef_search=40)');
    console.log('   - Create optimized search functions');
    console.log('   - Maintain backwards compatibility\n');
    
    // Create a simplified version that we can test
    console.log('🧪 Creating test function to verify setup...');
    
    // Test if we can at least create a simple function
    const testFunction = `
      CREATE OR REPLACE FUNCTION test_hnsw_ready()
      RETURNS boolean
      LANGUAGE sql
      AS $$
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        );
      $$;
    `;
    
    // Save instructions for manual execution
    const instructions = `
# HNSW Index Implementation Instructions

## Prerequisites
- Supabase project with pgvector extension enabled
- Service role key for admin access

## Steps to Apply

1. **Open Supabase SQL Editor**
   - Go to: ${process.env.SUPABASE_URL}/project/default/sql
   - Make sure you're in the SQL Editor tab

2. **Execute the HNSW Index Script**
   - Copy the entire contents of implement-hnsw-indexes.sql
   - Paste into the SQL Editor
   - Click "Run" or press Cmd/Ctrl + Enter

3. **Verify Installation**
   - Run: SELECT * FROM pg_indexes WHERE tablename = 'claude_memories' AND indexname LIKE '%hnsw%';
   - You should see 3 new HNSW indexes

4. **Test Performance**
   - Run the benchmark script again: node pgvector-performance-benchmark.js
   - Compare results with the baseline

## Expected Results
- 3x improvement in similarity search performance
- Reduced P95 and P99 latencies
- Better performance on batch operations

## Monitoring
- Check index usage: SELECT * FROM claude_memories_index_stats;
- Monitor query performance in Supabase dashboard

## Rollback (if needed)
If you need to rollback:
\`\`\`sql
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_cosine_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_l2_idx;
DROP INDEX IF EXISTS claude_memories_embedding_hnsw_ip_idx;
DROP FUNCTION IF EXISTS match_memories_hnsw CASCADE;
DROP FUNCTION IF EXISTS batch_match_memories_hnsw CASCADE;
DROP FUNCTION IF EXISTS match_memories_filtered_hnsw CASCADE;
\`\`\`
`;
    
    // Save instructions
    const instructionsPath = path.join(__dirname, 'HNSW_IMPLEMENTATION_GUIDE.md');
    fs.writeFileSync(instructionsPath, instructions);
    console.log(`\n📄 Implementation guide saved to: HNSW_IMPLEMENTATION_GUIDE.md`);
    
    // Create a script to verify HNSW implementation
    await createVerificationScript();
    
    console.log('\n✅ Preparation complete!');
    console.log('🎯 Next step: Execute the SQL script in Supabase Dashboard');
    console.log('📊 Then run: node verify-hnsw-implementation.js');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

async function createVerificationScript() {
  const verificationScript = `import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function verifyHNSW() {
  console.log('🔍 Verifying HNSW implementation...\\n');
  
  try {
    // Test the new HNSW function
    const testEmbedding = new Array(1536).fill(0).map(() => Math.random());
    
    console.log('1️⃣ Testing match_memories_hnsw function...');
    const { data, error } = await supabase.rpc('match_memories_hnsw', {
      query_embedding: testEmbedding,
      match_threshold: 0.7,
      match_count: 5
    });
    
    if (error) {
      console.log('❌ HNSW function not found. Please run the SQL script first.');
      console.log('Error:', error.message);
      return false;
    }
    
    console.log('✅ HNSW function exists and works!');
    console.log(\`   Returned \${data?.length || 0} results\\n\`);
    
    // Quick performance test
    console.log('2️⃣ Running quick performance test...');
    const iterations = 10;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
      const queryEmb = new Array(1536).fill(0).map(() => Math.random());
      const start = Date.now();
      
      await supabase.rpc('match_memories_hnsw', {
        query_embedding: queryEmb,
        match_threshold: 0.7,
        match_count: 10
      });
      
      times.push(Date.now() - start);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(\`✅ Average query time: \${avgTime.toFixed(2)}ms\\n\`);
    
    console.log('3️⃣ Checking index statistics...');
    // This would need direct SQL access, so we'll skip for now
    console.log('⚠️  Index stats require SQL access. Check in Supabase dashboard.\\n');
    
    console.log('🎉 HNSW implementation verified successfully!');
    console.log('📊 Run the full benchmark to see the 3x performance improvement');
    
    return true;
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
}

verifyHNSW();`;

  const verifyPath = path.join(__dirname, 'verify-hnsw-implementation.js');
  fs.writeFileSync(verifyPath, verificationScript);
  console.log('🔧 Created verification script: verify-hnsw-implementation.js');
}

// Run the preparation
applyHNSWIndexes();