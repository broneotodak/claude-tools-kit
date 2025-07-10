import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Update patterns for memory queries to use HNSW
const queryUpdates = [
  {
    file: '../src/memory/search.js',
    updates: [
      {
        old: `await supabase.rpc('match_memories', {`,
        new: `await supabase.rpc('match_memories_hnsw', {`,
        description: 'Update to use HNSW-optimized function'
      }
    ]
  },
  {
    file: '../src/memory/rag.js',
    updates: [
      {
        old: `const { data: memories, error } = await supabase.rpc('match_memories', {`,
        new: `const { data: memories, error } = await supabase.rpc('match_memories_hnsw', {`,
        description: 'Update RAG search to use HNSW'
      }
    ]
  },
  {
    file: '../src/api/memory-api.js',
    updates: [
      {
        old: `supabase.rpc('match_memories',`,
        new: `supabase.rpc('match_memories_hnsw',`,
        description: 'Update API endpoints to use HNSW'
      }
    ]
  }
];

// New optimized query templates
const optimizedQueries = {
  similaritySearch: `
// HNSW-optimized similarity search
async function searchMemoriesHNSW(queryEmbedding, options = {}) {
  const {
    threshold = 0.7,
    limit = 10,
    metadata = null,
    dateFrom = null,
    dateTo = null
  } = options;

  // Use filtered search if we have filters
  if (metadata || dateFrom || dateTo) {
    const { data, error } = await supabase.rpc('match_memories_filtered_hnsw', {
      query_embedding: queryEmbedding,
      filter_metadata: metadata,
      date_from: dateFrom,
      date_to: dateTo,
      match_threshold: threshold,
      match_count: limit
    });
    
    return { data, error };
  }
  
  // Use standard HNSW search
  const { data, error } = await supabase.rpc('match_memories_hnsw', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: limit
  });
  
  return { data, error };
}`,

  batchSearch: `
// HNSW-optimized batch search
async function batchSearchMemoriesHNSW(queryEmbeddings, options = {}) {
  const {
    threshold = 0.7,
    limit = 10
  } = options;

  const { data, error } = await supabase.rpc('batch_match_memories_hnsw', {
    query_embeddings: queryEmbeddings,
    match_threshold: threshold,
    match_count: limit
  });
  
  if (error) return { data: null, error };
  
  // Group results by query index
  const grouped = data.reduce((acc, result) => {
    if (!acc[result.query_index]) {
      acc[result.query_index] = [];
    }
    acc[result.query_index].push(result);
    return acc;
  }, {});
  
  return { data: grouped, error: null };
}`,

  hybridSearch: `
// Hybrid search combining vector similarity with keyword search
async function hybridSearchHNSW(query, queryEmbedding, options = {}) {
  const {
    threshold = 0.7,
    limit = 20,
    keywordWeight = 0.3,
    vectorWeight = 0.7
  } = options;

  // Parallel execution of both searches
  const [vectorResults, keywordResults] = await Promise.all([
    // Vector search with HNSW
    supabase.rpc('match_memories_hnsw', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit
    }),
    
    // Full-text search
    supabase
      .from('claude_memories')
      .select('id, content, metadata, created_at')
      .textSearch('content', query)
      .limit(limit)
  ]);

  if (vectorResults.error || keywordResults.error) {
    return { 
      data: null, 
      error: vectorResults.error || keywordResults.error 
    };
  }

  // Merge and re-rank results
  const merged = mergeSearchResults(
    vectorResults.data,
    keywordResults.data,
    keywordWeight,
    vectorWeight
  );

  return { data: merged.slice(0, limit), error: null };
}`
};

// Create optimized query examples
function createOptimizedQueryExamples() {
  const examples = `# HNSW-Optimized Memory Query Examples

## Basic Similarity Search
\`\`\`javascript
${optimizedQueries.similaritySearch}
\`\`\`

## Batch Search for Multiple Queries
\`\`\`javascript
${optimizedQueries.batchSearch}
\`\`\`

## Hybrid Search (Vector + Keyword)
\`\`\`javascript
${optimizedQueries.hybridSearch}
\`\`\`

## Performance Tips

1. **Use appropriate thresholds**: 
   - 0.7 - 0.8 for general similarity
   - 0.8 - 0.9 for high similarity
   - 0.9+ for near-duplicate detection

2. **Optimize limit parameter**:
   - Keep under 50 for real-time queries
   - Use pagination for larger result sets

3. **Leverage filtered search**:
   - Use metadata filters to reduce search space
   - Combine with date ranges for temporal queries

4. **Batch operations**:
   - Process multiple queries together
   - Reduces overhead and improves throughput

5. **Monitor performance**:
   - Track query times with performance logging
   - Adjust ef_search parameter if needed

## Migration Checklist

- [ ] Update all \`match_memories\` calls to \`match_memories_hnsw\`
- [ ] Implement filtered search where applicable
- [ ] Add batch processing for multiple queries
- [ ] Update error handling for new functions
- [ ] Add performance monitoring
- [ ] Test with production-like data volumes
`;

  const examplesPath = path.join(__dirname, 'HNSW_QUERY_EXAMPLES.md');
  fs.writeFileSync(examplesPath, examples);
  console.log('📝 Created query examples: HNSW_QUERY_EXAMPLES.md');
}

// Create migration script
function createMigrationScript() {
  const migrationScript = `#!/bin/bash
# Quick migration script to update memory queries

echo "🔄 Updating memory queries to use HNSW..."

# Find all files with memory queries
find ../src -name "*.js" -type f | while read file; do
  if grep -q "match_memories" "$file"; then
    echo "Updating: $file"
    
    # Create backup
    cp "$file" "$file.backup"
    
    # Replace function calls
    sed -i '' 's/match_memories(/match_memories_hnsw(/g' "$file"
    
    # Show changes
    if ! diff -q "$file" "$file.backup" > /dev/null; then
      echo "  ✅ Updated"
    else
      echo "  ⏭️  No changes needed"
      rm "$file.backup"
    fi
  fi
done

echo "✨ Migration complete!"
`;

  const scriptPath = path.join(__dirname, 'migrate-to-hnsw.sh');
  fs.writeFileSync(scriptPath, migrationScript);
  fs.chmodSync(scriptPath, '755');
  console.log('🔧 Created migration script: migrate-to-hnsw.sh');
}

// Performance comparison helper
function createPerformanceComparison() {
  const comparison = `import { createClient } from '@supabase/supabase-js';
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

async function comparePerformance() {
  console.log('📊 Comparing query performance: Old vs HNSW\\n');
  
  const testEmbedding = new Array(1536).fill(0).map(() => Math.random());
  const iterations = 50;
  
  // Test old function (if still exists)
  console.log('Testing original match_memories...');
  const oldTimes = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    
    try {
      await supabase.rpc('match_memories', {
        query_embedding: testEmbedding,
        match_threshold: 0.7,
        match_count: 10
      });
    } catch (error) {
      console.log('Original function not found, skipping...');
      break;
    }
    
    oldTimes.push(performance.now() - start);
  }
  
  // Test HNSW function
  console.log('Testing HNSW match_memories_hnsw...');
  const hnswTimes = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    
    await supabase.rpc('match_memories_hnsw', {
      query_embedding: testEmbedding,
      match_threshold: 0.7,
      match_count: 10
    });
    
    hnswTimes.push(performance.now() - start);
  }
  
  // Calculate statistics
  const oldAvg = oldTimes.length > 0 
    ? oldTimes.reduce((a, b) => a + b, 0) / oldTimes.length 
    : null;
  const hnswAvg = hnswTimes.reduce((a, b) => a + b, 0) / hnswTimes.length;
  
  console.log('\\n📈 Results:');
  if (oldAvg) {
    console.log(\`Original: \${oldAvg.toFixed(2)}ms average\`);
    console.log(\`HNSW: \${hnswAvg.toFixed(2)}ms average\`);
    console.log(\`\\n🚀 Performance improvement: \${(oldAvg / hnswAvg).toFixed(2)}x faster!\`);
  } else {
    console.log(\`HNSW: \${hnswAvg.toFixed(2)}ms average\`);
    console.log('(Original function not available for comparison)');
  }
  
  // Test batch performance
  console.log('\\n📦 Testing batch performance...');
  const batchEmbeddings = Array(10).fill(0).map(() => 
    new Array(1536).fill(0).map(() => Math.random())
  );
  
  const batchStart = performance.now();
  await supabase.rpc('batch_match_memories_hnsw', {
    query_embeddings: batchEmbeddings,
    match_threshold: 0.7,
    match_count: 5
  });
  const batchTime = performance.now() - batchStart;
  
  console.log(\`Batch search (10 queries): \${batchTime.toFixed(2)}ms total\`);
  console.log(\`Per-query time: \${(batchTime / 10).toFixed(2)}ms\`);
}

comparePerformance();`;

  const comparisonPath = path.join(__dirname, 'compare-performance.js');
  fs.writeFileSync(comparisonPath, comparison);
  console.log('📊 Created performance comparison: compare-performance.js');
}

// Main execution
console.log('🔄 Creating query update resources...\n');

createOptimizedQueryExamples();
createMigrationScript();
createPerformanceComparison();

console.log('\n✅ Query update resources created!');
console.log('\n📋 Next steps:');
console.log('1. Review HNSW_QUERY_EXAMPLES.md for optimized query patterns');
console.log('2. Run ./migrate-to-hnsw.sh to update existing queries');
console.log('3. Run node compare-performance.js to verify improvements');
console.log('\n💡 Remember to update any external tools or APIs that use the memory search!');