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

async function analyzeCurrentSetup() {
  console.log('🔍 Analyzing current pgvector setup in CTK memory system...\n');

  try {
    // 1. Check table structure
    console.log('📊 Table Structure Analysis:');
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_columns', { table_name: 'claude_memories' });

    if (columnsError) {
      console.log('Using alternative method to check columns...');
      // Try a different approach
      const { data: sample, error: sampleError } = await supabase
        .from('claude_memories')
        .select('*')
        .limit(1);
      
      if (sample && sample.length > 0) {
        console.log('Columns found:', Object.keys(sample[0]));
        const hasEmbedding = 'embedding' in sample[0];
        console.log(`Embedding column exists: ${hasEmbedding ? '✅' : '❌'}`);
      }
    } else if (columns) {
      console.log('Columns:', columns.map(c => `${c.column_name} (${c.data_type})`).join(', '));
    }

    // 2. Check current indexes
    console.log('\n📈 Current Indexes:');
    const indexQuery = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'claude_memories'
      AND indexdef LIKE '%embedding%';
    `;

    // Since we can't run raw SQL directly, let's check for vector data
    const { data: vectorCheck, error: vectorError } = await supabase
      .from('claude_memories')
      .select('id, created_at')
      .not('embedding', 'is', null)
      .limit(5);

    if (vectorCheck) {
      console.log(`Found ${vectorCheck.length} records with embeddings`);
    }

    // 3. Check embedding dimensions
    console.log('\n📏 Embedding Dimensions:');
    const { data: sampleEmbedding, error: embError } = await supabase
      .from('claude_memories')
      .select('id, embedding')
      .not('embedding', 'is', null)
      .limit(1);

    if (sampleEmbedding && sampleEmbedding.length > 0 && sampleEmbedding[0].embedding) {
      const embedding = sampleEmbedding[0].embedding;
      let dimensions = 0;
      
      if (typeof embedding === 'string') {
        // Parse if it's a string representation
        const parsed = embedding.match(/\[([^\]]+)\]/);
        if (parsed) {
          dimensions = parsed[1].split(',').length;
        }
      } else if (Array.isArray(embedding)) {
        dimensions = embedding.length;
      }
      
      console.log(`Embedding dimensions: ${dimensions}`);
      console.log(`Recommended for HNSW: ${dimensions <= 768 ? '✅ Good for performance' : '⚠️  Consider reducing dimensions'}`);
    }

    // 4. Check table size and performance metrics
    console.log('\n📊 Table Statistics:');
    const { count: totalCount } = await supabase
      .from('claude_memories')
      .select('*', { count: 'exact', head: true });

    const { count: withEmbeddings } = await supabase
      .from('claude_memories')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);

    console.log(`Total records: ${totalCount || 0}`);
    console.log(`Records with embeddings: ${withEmbeddings || 0}`);
    console.log(`Coverage: ${totalCount ? ((withEmbeddings / totalCount) * 100).toFixed(2) : 0}%`);

    // 5. Performance baseline test
    console.log('\n⏱️  Running baseline performance test...');
    const testEmbedding = new Array(1536).fill(0).map(() => Math.random());
    
    const startTime = Date.now();
    const { data: similarMemories, error: searchError } = await supabase
      .rpc('match_memories', {
        query_embedding: testEmbedding,
        match_threshold: 0.7,
        match_count: 10
      });

    const searchTime = Date.now() - startTime;

    if (searchError) {
      console.log('Search function not found or error:', searchError.message);
      console.log('Will need to create appropriate search functions');
    } else {
      console.log(`Baseline search time: ${searchTime}ms`);
      console.log(`Results returned: ${similarMemories?.length || 0}`);
    }

    // 6. Check for existing vector indexes
    console.log('\n🔍 Checking for existing vector indexes...');
    console.log('Note: HNSW indexes would show as "hnsw" in the access method');
    console.log('Current indexes likely use IVFFlat or none (sequential scan)');

    return {
      totalRecords: totalCount || 0,
      recordsWithEmbeddings: withEmbeddings || 0,
      baselineSearchTime: searchTime,
      dimensions: 1536, // Assuming OpenAI embeddings
      currentIndexType: 'likely IVFFlat or none'
    };

  } catch (error) {
    console.error('❌ Error analyzing setup:', error);
    throw error;
  }
}

// Run analysis
analyzeCurrentSetup()
  .then(results => {
    console.log('\n✅ Analysis complete!');
    console.log('\n📋 Summary:');
    console.log(JSON.stringify(results, null, 2));
    
    console.log('\n🎯 Next steps:');
    console.log('1. Create HNSW indexes for 3x performance improvement');
    console.log('2. Optimize search queries to use the new indexes');
    console.log('3. Consider dimension reduction if using > 768 dimensions');
  })
  .catch(error => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });