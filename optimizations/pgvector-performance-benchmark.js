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

// Benchmark configuration
const BENCHMARK_CONFIG = {
  searchIterations: 100,
  topK: [1, 5, 10, 20, 50],
  thresholds: [0.5, 0.7, 0.8, 0.9],
  warmupRuns: 5
};

class PgVectorBenchmark {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      systemInfo: {
        indexType: 'baseline',
        dimensions: 1536,
        totalRecords: 0,
        recordsWithEmbeddings: 0
      },
      benchmarks: []
    };
  }

  async initialize() {
    console.log('🚀 Initializing pgvector performance benchmark...\n');
    
    // Get system info
    const { count: totalCount } = await supabase
      .from('claude_memories')
      .select('*', { count: 'exact', head: true });

    const { count: withEmbeddings } = await supabase
      .from('claude_memories')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);

    this.results.systemInfo.totalRecords = totalCount || 0;
    this.results.systemInfo.recordsWithEmbeddings = withEmbeddings || 0;

    console.log(`📊 System Info:`);
    console.log(`   Total records: ${totalCount}`);
    console.log(`   With embeddings: ${withEmbeddings}`);
    console.log(`   Coverage: ${((withEmbeddings / totalCount) * 100).toFixed(2)}%\n`);
  }

  generateRandomEmbedding(dimensions = 1536) {
    return new Array(dimensions).fill(0).map(() => Math.random() * 2 - 1);
  }

  async warmup() {
    console.log('🔥 Running warmup queries...');
    const warmupEmbedding = this.generateRandomEmbedding();
    
    for (let i = 0; i < BENCHMARK_CONFIG.warmupRuns; i++) {
      await supabase.rpc('match_memories', {
        query_embedding: warmupEmbedding,
        match_threshold: 0.7,
        match_count: 10
      });
    }
    console.log('✅ Warmup complete\n');
  }

  async benchmarkSimilaritySearch() {
    console.log('📏 Benchmarking similarity search performance...\n');

    for (const topK of BENCHMARK_CONFIG.topK) {
      for (const threshold of BENCHMARK_CONFIG.thresholds) {
        const times = [];
        const errors = [];
        
        console.log(`Testing: top_k=${topK}, threshold=${threshold}`);
        
        for (let i = 0; i < BENCHMARK_CONFIG.searchIterations; i++) {
          const queryEmbedding = this.generateRandomEmbedding();
          const startTime = performance.now();
          
          try {
            const { data, error } = await supabase.rpc('match_memories', {
              query_embedding: queryEmbedding,
              match_threshold: threshold,
              match_count: topK
            });
            
            const endTime = performance.now();
            
            if (error) {
              errors.push(error.message);
            } else {
              times.push(endTime - startTime);
            }
          } catch (err) {
            errors.push(err.message);
          }
          
          // Progress indicator
          if ((i + 1) % 20 === 0) {
            process.stdout.write('.');
          }
        }
        
        console.log(' Done!');
        
        // Calculate statistics
        if (times.length > 0) {
          const stats = this.calculateStats(times);
          
          this.results.benchmarks.push({
            test: 'similarity_search',
            parameters: { topK, threshold },
            iterations: BENCHMARK_CONFIG.searchIterations,
            successfulRuns: times.length,
            errors: errors.length,
            stats,
            errorSample: errors.slice(0, 3)
          });
          
          console.log(`   Avg: ${stats.mean.toFixed(2)}ms, P95: ${stats.p95.toFixed(2)}ms, P99: ${stats.p99.toFixed(2)}ms\n`);
        } else {
          console.log(`   ❌ All queries failed\n`);
        }
      }
    }
  }

  async benchmarkBatchOperations() {
    console.log('📦 Benchmarking batch operations...\n');
    
    const batchSizes = [1, 5, 10, 20];
    
    for (const batchSize of batchSizes) {
      console.log(`Testing batch size: ${batchSize}`);
      const times = [];
      
      for (let i = 0; i < 20; i++) {
        const embeddings = Array(batchSize).fill(0).map(() => this.generateRandomEmbedding());
        const startTime = performance.now();
        
        // Simulate batch similarity search
        const promises = embeddings.map(embedding => 
          supabase.rpc('match_memories', {
            query_embedding: embedding,
            match_threshold: 0.7,
            match_count: 10
          })
        );
        
        await Promise.all(promises);
        const endTime = performance.now();
        
        times.push((endTime - startTime) / batchSize); // Per-query time
      }
      
      const stats = this.calculateStats(times);
      
      this.results.benchmarks.push({
        test: 'batch_operations',
        parameters: { batchSize },
        iterations: 20,
        stats,
        perQueryTime: stats.mean
      });
      
      console.log(`   Per-query time: ${stats.mean.toFixed(2)}ms\n`);
    }
  }

  async benchmarkFilteredSearch() {
    console.log('🔍 Benchmarking filtered search...\n');
    
    // Test searching with metadata filters
    const filters = [
      { type: 'no_filter', filter: {} },
      { type: 'date_range', filter: { days: 7 } },
      { type: 'date_range', filter: { days: 30 } },
      { type: 'specific_project', filter: { project: 'claude-tools-kit' } }
    ];
    
    for (const { type, filter } of filters) {
      console.log(`Testing filter: ${type}`);
      const times = [];
      
      for (let i = 0; i < 50; i++) {
        const queryEmbedding = this.generateRandomEmbedding();
        const startTime = performance.now();
        
        // Build query based on filter type
        let query = supabase
          .from('claude_memories')
          .select('id, content, similarity')
          .not('embedding', 'is', null);
        
        if (filter.days) {
          const dateThreshold = new Date();
          dateThreshold.setDate(dateThreshold.getDate() - filter.days);
          query = query.gte('created_at', dateThreshold.toISOString());
        }
        
        if (filter.project) {
          query = query.ilike('content', `%${filter.project}%`);
        }
        
        // Note: This is a simplified test since we can't do vector similarity 
        // directly in the select. In production, you'd use a function.
        const { data, error } = await query.limit(10);
        
        const endTime = performance.now();
        times.push(endTime - startTime);
      }
      
      const stats = this.calculateStats(times);
      
      this.results.benchmarks.push({
        test: 'filtered_search',
        parameters: { type, filter },
        iterations: 50,
        stats
      });
      
      console.log(`   Avg: ${stats.mean.toFixed(2)}ms\n`);
    }
  }

  calculateStats(times) {
    const sorted = times.sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      stdDev: this.calculateStdDev(sorted, sum / sorted.length)
    };
  }

  calculateStdDev(values, mean) {
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  async saveResults(filename) {
    const resultsPath = path.join(__dirname, filename);
    fs.writeFileSync(resultsPath, JSON.stringify(this.results, null, 2));
    console.log(`💾 Results saved to: ${filename}`);
  }

  generateReport() {
    console.log('\n📊 PERFORMANCE BENCHMARK REPORT');
    console.log('================================\n');
    
    console.log('System Information:');
    console.log(`- Index Type: ${this.results.systemInfo.indexType}`);
    console.log(`- Total Records: ${this.results.systemInfo.totalRecords.toLocaleString()}`);
    console.log(`- Records with Embeddings: ${this.results.systemInfo.recordsWithEmbeddings.toLocaleString()}`);
    console.log(`- Embedding Dimensions: ${this.results.systemInfo.dimensions}`);
    
    console.log('\n🎯 Key Performance Metrics:\n');
    
    // Find the most common search scenario (topK=10, threshold=0.7)
    const typicalSearch = this.results.benchmarks.find(b => 
      b.test === 'similarity_search' && 
      b.parameters.topK === 10 && 
      b.parameters.threshold === 0.7
    );
    
    if (typicalSearch) {
      console.log('Typical Search (top_k=10, threshold=0.7):');
      console.log(`- Average: ${typicalSearch.stats.mean.toFixed(2)}ms`);
      console.log(`- P95: ${typicalSearch.stats.p95.toFixed(2)}ms`);
      console.log(`- P99: ${typicalSearch.stats.p99.toFixed(2)}ms`);
    }
    
    console.log('\n📈 Performance by Operation Type:\n');
    
    const testTypes = [...new Set(this.results.benchmarks.map(b => b.test))];
    
    testTypes.forEach(testType => {
      console.log(`${testType}:`);
      const tests = this.results.benchmarks.filter(b => b.test === testType);
      
      tests.forEach(test => {
        const paramStr = Object.entries(test.parameters)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        console.log(`  ${paramStr}: ${test.stats.mean.toFixed(2)}ms avg`);
      });
      console.log();
    });
    
    console.log('🎯 Optimization Targets:');
    console.log('- Reduce average search time by 3x');
    console.log('- Improve P99 latency for better consistency');
    console.log('- Optimize batch operations for parallel processing');
  }
}

// Run benchmark
async function runBenchmark() {
  const benchmark = new PgVectorBenchmark();
  
  try {
    await benchmark.initialize();
    await benchmark.warmup();
    
    // Run all benchmarks
    await benchmark.benchmarkSimilaritySearch();
    await benchmark.benchmarkBatchOperations();
    await benchmark.benchmarkFilteredSearch();
    
    // Save results
    await benchmark.saveResults('benchmark-results-before-hnsw.json');
    
    // Generate report
    benchmark.generateReport();
    
    console.log('\n✅ Benchmark complete!');
    console.log('\n🚀 Ready to implement HNSW indexes for 3x performance improvement!');
    
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Execute
runBenchmark();