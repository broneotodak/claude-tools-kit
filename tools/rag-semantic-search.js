#!/usr/bin/env node

/**
 * RAG Semantic Search for Claude Code
 * Performs semantic similarity search using embeddings
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
require('dotenv').config();

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey || !openaiKey) {
    console.error('❌ Missing required credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Create embedding for query
async function createEmbedding(text) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            input: text,
            model: "text-embedding-ada-002"
        });

        const options = {
            hostname: 'api.openai.com',
            port: 443,
            path: '/v1/embeddings',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    if (parsed.data && parsed.data[0] && parsed.data[0].embedding) {
                        resolve(parsed.data[0].embedding);
                    } else {
                        reject(new Error('Invalid embedding response'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function semanticSearch(query, options = {}) {
    const limit = options.limit || 5;
    const threshold = options.threshold || 0.75;

    console.log('🔍 RAG Semantic Search\n');
    console.log(`Query: "${query}"`);
    console.log(`Similarity threshold: ${threshold}`);
    console.log(`Results limit: ${limit}\n`);

    try {
        // Generate embedding for the query
        console.log('🧠 Generating query embedding...');
        const queryEmbedding = await createEmbedding(query);

        // Perform semantic search using Supabase RPC function
        console.log('🔎 Searching memories...\n');
        
        // Use raw SQL for similarity search
        const { data: results, error } = await supabase.rpc('match_memories', {
            query_embedding: queryEmbedding,
            match_threshold: threshold,
            match_count: limit
        });

        if (error) {
            // If RPC doesn't exist, create it
            if (error.message.includes('could not find')) {
                console.log('⚠️  Similarity search function not found.');
                console.log('Creating search function...\n');
                
                // Create the function
                const createFunction = `
                    CREATE OR REPLACE FUNCTION match_memories (
                        query_embedding vector(1536),
                        match_threshold float,
                        match_count int
                    )
                    RETURNS TABLE (
                        id bigint,
                        content text,
                        metadata jsonb,
                        category text,
                        importance int,
                        created_at timestamp,
                        similarity float
                    )
                    LANGUAGE plpgsql
                    AS $$
                    BEGIN
                        RETURN QUERY
                        SELECT 
                            cdm.id,
                            cdm.content,
                            cdm.metadata,
                            cdm.category,
                            cdm.importance,
                            cdm.created_at,
                            1 - (cdm.embedding <=> query_embedding) as similarity
                        FROM claude_desktop_memory cdm
                        WHERE cdm.embedding IS NOT NULL
                        AND 1 - (cdm.embedding <=> query_embedding) > match_threshold
                        ORDER BY cdm.embedding <=> query_embedding
                        LIMIT match_count;
                    END;
                    $$;
                `;

                console.log('💡 Please run this SQL in your Supabase dashboard:\n');
                console.log(createFunction);
                console.log('\nThen run this tool again.');
                return;
            }
            
            console.error('❌ Search error:', error);
            return;
        }

        if (!results || results.length === 0) {
            console.log('❌ No similar memories found.');
            console.log('\n💡 Tips:');
            console.log('  - Try different keywords');
            console.log('  - Lower the threshold with -t 0.5');
            console.log('  - Ensure memories have embeddings: node rag-embed-memories.js');
            return;
        }

        // Display results
        console.log(`✅ Found ${results.length} similar memories:\n`);

        results.forEach((memory, index) => {
            const date = new Date(memory.created_at).toLocaleDateString();
            const proj = memory.metadata?.project || 'General';
            const similarity = (memory.similarity * 100).toFixed(1);
            
            console.log(`${index + 1}. [${similarity}% match] ${proj} - ${memory.category}`);
            console.log(`   Date: ${date}`);
            console.log(`   Importance: ${memory.importance}/10`);
            console.log(`   Content: ${memory.content.substring(0, 200)}...`);
            console.log('');
        });

        // Generate context block
        if (options.context) {
            console.log('\n=== Context for Claude ===\n');
            results.forEach((memory) => {
                console.log(`[${memory.metadata?.project || 'General'}] ${memory.content}\n`);
            });
            console.log('=== End Context ===');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

// Parse command line
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
RAG Semantic Search

Uses AI embeddings to find semantically similar memories.

Usage: node rag-semantic-search.js [options] <query>

Options:
  --limit, -l      Number of results (default: 5)
  --threshold, -t  Similarity threshold 0-1 (default: 0.75)
  --context, -c    Output as context block for Claude

Examples:
  node rag-semantic-search.js "how to handle webhooks"
  node rag-semantic-search.js -t 0.6 -l 10 "memory optimization"
  node rag-semantic-search.js --context "FlowState dashboard"

Note: Requires memories to have embeddings.
      Run rag-embed-memories.js first if needed.
`);
    process.exit(0);
}

// Parse options
const options = {
    limit: 5,
    threshold: 0.75,
    context: false
};

let queryParts = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' || args[i] === '-l') {
        options.limit = parseInt(args[++i]);
    } else if (args[i] === '--threshold' || args[i] === '-t') {
        options.threshold = parseFloat(args[++i]);
    } else if (args[i] === '--context' || args[i] === '-c') {
        options.context = true;
    } else {
        queryParts.push(args[i]);
    }
}

const query = queryParts.join(' ');
semanticSearch(query, options);