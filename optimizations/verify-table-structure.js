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

async function verifyTableStructure() {
  console.log('🔍 Verifying CTK memory table structure...\n');
  
  const tables = ['claude_memories', 'claude_desktop_memory', 'memories'];
  
  for (const tableName of tables) {
    console.log(`\nChecking table: ${tableName}`);
    console.log('=' + '='.repeat(40));
    
    try {
      // Try to select from the table
      const { data, error, count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ Table not found or error: ${error.message}`);
        continue;
      }
      
      console.log(`✅ Table exists!`);
      
      // Get a sample record to check structure
      const { data: sample, error: sampleError } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);
      
      if (sample && sample.length > 0) {
        const record = sample[0];
        console.log('\n📊 Table columns:');
        Object.keys(record).forEach(column => {
          const value = record[column];
          let type = typeof value;
          if (value === null) type = 'null';
          else if (Array.isArray(value)) type = `array[${value.length}]`;
          else if (type === 'object') type = 'jsonb';
          
          console.log(`   - ${column}: ${type}`);
        });
        
        // Check for embedding column
        if ('embedding' in record) {
          console.log('\n✅ Embedding column found!');
          if (record.embedding) {
            const embeddingLength = Array.isArray(record.embedding) 
              ? record.embedding.length 
              : 'unknown';
            console.log(`   Dimensions: ${embeddingLength}`);
          }
        } else {
          console.log('\n⚠️  No embedding column found');
        }
      }
      
      // Get count
      const { count: totalCount } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      console.log(`\n📈 Total records: ${totalCount || 0}`);
      
      // Check for embeddings
      if (sample && sample.length > 0 && 'embedding' in sample[0]) {
        const { count: embeddingCount } = await supabase
          .from(tableName)
          .select('*', { count: 'exact', head: true })
          .not('embedding', 'is', null);
        
        console.log(`   With embeddings: ${embeddingCount || 0}`);
        console.log(`   Coverage: ${totalCount ? ((embeddingCount / totalCount) * 100).toFixed(2) : 0}%`);
      }
      
    } catch (err) {
      console.log(`❌ Error checking table: ${err.message}`);
    }
  }
  
  console.log('\n\n📝 Summary:');
  console.log('Based on the checks above, identify which table is actually being used');
  console.log('for the CTK memory system and update the HNSW implementation accordingly.');
}

// Run verification
verifyTableStructure()
  .then(() => {
    console.log('\n✅ Verification complete!');
  })
  .catch(error => {
    console.error('❌ Verification failed:', error);
  });